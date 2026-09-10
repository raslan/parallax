"""Audio library scanner: walk, ffprobe, upsert `AudioFile` rows.

Structurally this is the video scanner (`services/scanner.py`) minus frame
extraction and thumbnails. The ffprobe-field-mapping logic lives in
`_probe_audio_metadata`, shared by `rescan_audio_file` and `scan_audio_library`.
"""

import concurrent.futures as _cf
import json
import os
import subprocess
from datetime import datetime

from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.file import FileStatus
from app.models.job import Job, JobStatus
from app.services.common import (
    arm_cancel,
    clear_cancel,
    is_ignored_media_name,
    log,
    now,
    should_cancel,
)

AUDIO_EXTENSIONS = {
    ".mp3",
    ".m4a",
    ".m4b",
    ".aac",
    ".opus",
    ".ogg",
    ".oga",
    ".flac",
    ".wav",
    ".wma",
    ".aiff",
    ".aif",
    ".alac",
}

# Commit progress to the DB every this many files during the scan loop.
_PROGRESS_EVERY = 50

# Hard ceiling on how long probing one file may take. ffprobe already has its own
# 30s timeout, but the surrounding os.stat / os.path.getmtime calls have none and
# block uninterruptibly on an unresponsive mount — this keeps one bad path from
# wedging the whole (uncancellable-while-blocked) scan loop.
_PROBE_TIMEOUT = 90


def _probe_audio_metadata_guarded(path: str) -> dict:
    """`_probe_audio_metadata` with a `_PROBE_TIMEOUT` wall-clock cap.

    On timeout the worker thread is abandoned — it may stay blocked in the kernel
    (D-state on a dead mount) but the scan moves on — and a probe-failure dict is
    returned so the row is marked UNKNOWN rather than the job hanging forever.
    """
    ex = _cf.ThreadPoolExecutor(max_workers=1)
    try:
        return ex.submit(_probe_audio_metadata, path).result(timeout=_PROBE_TIMEOUT)
    except _cf.TimeoutError:
        ts = now().timestamp()
        return {
            "size": None,
            "duration": None,
            "codec_name": None,
            "bitrate": None,
            "sample_rate": None,
            "channels": None,
            "channel_layout": None,
            "probe_ok": False,
            "file_mtime": ts,
            "file_date": ts,
        }
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def probe_audio(path: str) -> dict:
    """Run ffprobe on the first audio stream + format, return the raw JSON dict.

    Returns `{}` on any failure (non-zero exit / `CalledProcessError`,
    malformed output / `JSONDecodeError`, or timeout).
    """
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name,sample_rate,channels,channel_layout,bit_rate",
                "-show_entries",
                "format=size,duration,bit_rate,tags",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return {}
        return json.loads(result.stdout)
    except Exception:
        return {}


def _probe_audio_metadata(path: str) -> dict:
    """Probe an audio file and return a flat dict of `AudioFile`-column values.

    Does not touch the DB; callers assign the returned values onto their own
    `AudioFile` row. `probe_ok` is False when ffprobe failed outright — callers
    updating an existing row should then leave the metadata fields untouched
    rather than null them over a transient failure.
    """
    result: dict = {
        "size": None,
        "duration": None,
        "codec_name": None,
        "bitrate": None,
        "sample_rate": None,
        "channels": None,
        "channel_layout": None,
        "probe_ok": False,
    }

    try:
        result["size"] = os.stat(path).st_size
    except OSError:
        pass

    data = probe_audio(path)
    if data:
        result["probe_ok"] = True
        fmt = data.get("format", {})
        streams = data.get("streams", [])
        if fmt.get("duration"):
            result["duration"] = float(fmt["duration"])
        if fmt.get("size"):
            result["size"] = int(fmt["size"])
        if streams:
            s = streams[0]
            if s.get("codec_name"):
                result["codec_name"] = s["codec_name"]
            br = s.get("bit_rate") or fmt.get("bit_rate")
            if br:
                try:
                    result["bitrate"] = int(br)
                except (ValueError, TypeError):
                    pass
            if s.get("sample_rate"):
                try:
                    result["sample_rate"] = int(s["sample_rate"])
                except (ValueError, TypeError):
                    pass
            if s.get("channels") is not None:
                try:
                    result["channels"] = int(s["channels"])
                except (ValueError, TypeError):
                    pass
            if s.get("channel_layout"):
                result["channel_layout"] = str(s["channel_layout"])

    tags = data.get("format", {}).get("tags", {}) if data else {}
    creation_time_str = tags.get("creation_time") or tags.get("date")
    try:
        file_mtime = os.path.getmtime(path)
    except OSError:
        file_mtime = now().timestamp()
    file_date = file_mtime
    if creation_time_str:
        try:
            dt = datetime.fromisoformat(str(creation_time_str).replace("Z", "+00:00"))
            file_date = dt.timestamp()
        except (ValueError, TypeError):
            pass

    result["file_mtime"] = file_mtime
    result["file_date"] = file_date
    return result


def _find_audio_files(library_path: str) -> list[str]:
    paths = []
    for root, dirs, files in os.walk(library_path):
        dirs[:] = [d for d in dirs if d != "_originals"]
        for name in files:
            if is_ignored_media_name(name):
                continue
            if os.path.splitext(name)[1].lower() not in AUDIO_EXTENSIONS:
                continue
            full = os.path.join(root, name)
            # Only real files (os.path.isfile follows symlinks to their target).
            # A FIFO / device / socket that happens to carry an audio extension
            # would block ffprobe and the unguarded stat calls forever, wedging
            # the scan loop with no way to cancel it.
            try:
                if not os.path.isfile(full):
                    continue
            except OSError:
                continue
            paths.append(full)
    return sorted(paths)


_METADATA_KEYS = (
    "duration",
    "codec_name",
    "bitrate",
    "sample_rate",
    "channels",
    "channel_layout",
)


def rescan_audio_file(db, audio_file: AudioFile) -> None:
    """Re-probe metadata for one `AudioFile` already in the DB, in place.

    Used right after something changes a file's bytes (e.g. an in-place
    re-encode) so the row reflects the new file immediately. Deliberately does
    NOT touch `status`, `file_mtime`, or `file_date`: rewriting a file in place
    changes the OS mtime for real, but re-reading it here would make "File
    added" jump to whenever Parallax last re-encoded the file instead of
    staying at the value from the original scan.
    """
    meta = _probe_audio_metadata(audio_file.path)
    if meta["size"] is not None:
        audio_file.size = meta["size"]
    if meta["probe_ok"]:
        for key in _METADATA_KEYS:
            setattr(audio_file, key, meta[key])
    audio_file.scanned_at = now()
    db.commit()


def scan_audio_library(library_id: int, job_id: int) -> None:
    """Job body: discover audio files, probe metadata, upsert `AudioFile` rows.

    The endpoint (see the libraries router) already created the `Job` row as
    PENDING and passes `job_id` here — this loads that row and drives it to
    RUNNING / COMPLETED. Cancellable at every checkpoint; commits progress
    incrementally. After the walk, `AudioFile` rows whose `path` no longer
    exists on disk are deleted.
    """
    db = SessionLocal()
    job: Job | None = None
    try:
        job = db.get(Job, job_id)
        if job is None:
            return

        library = db.get(AudioLibrary, library_id)
        if library is None:
            job.status = JobStatus.CANCELLED
            job.error = "Audio library was deleted"
            job.finished_at = now()
            db.commit()
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        log(db, job_id, f"Scanning audio library: {library.path}")
        audio_paths = _find_audio_files(library.path)

        # File walk is done — the library may have been deleted while we walked;
        # bail before entering the slow per-file loop (parity with scan_library).
        db.expire_all()
        if db.get(AudioLibrary, library_id) is None:
            job.status = JobStatus.CANCELLED
            job.error = "Library was deleted"
            job.finished_at = now()
            db.commit()
            return

        arm_cancel(job_id)
        if should_cancel(job_id):
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            db.commit()
            log(db, job_id, "Audio scan cancelled")
            return

        job.total_files = len(audio_paths)
        db.commit()
        log(db, job_id, f"Found {len(audio_paths)} audio files")

        existing = {
            f.path: f for f in db.query(AudioFile).filter(AudioFile.library_id == library_id).all()
        }

        completed = 0
        cancelled = False
        for path in audio_paths:
            if should_cancel(job_id):
                cancelled = True
                break

            row = existing.get(path)
            if row is None:
                row = AudioFile(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower(),
                )
                db.add(row)
                existing[path] = row

            try:
                meta = _probe_audio_metadata_guarded(path)
            except Exception as exc:  # noqa: BLE001 - record the failure, keep scanning
                row.status = FileStatus.UNKNOWN
                row.scan_error = str(exc)
            else:
                if meta["size"] is not None:
                    row.size = meta["size"]
                if meta["probe_ok"]:
                    for key in _METADATA_KEYS:
                        setattr(row, key, meta[key])
                    row.status = FileStatus.DONE
                    row.scan_error = None
                else:
                    row.status = FileStatus.UNKNOWN
                    row.scan_error = "ffprobe failed"
                row.file_mtime = meta["file_mtime"]
                row.file_date = meta["file_date"]

            row.scanned_at = now()
            completed += 1

            if completed % _PROGRESS_EVERY == 0:
                job.processed_files = completed
                job.progress = completed / len(audio_paths) * 100 if audio_paths else 100.0
                db.commit()

        db.commit()

        if cancelled:
            job.status = JobStatus.CANCELLED
            job.processed_files = completed
            job.finished_at = now()
            db.commit()
            log(db, job_id, "Audio scan cancelled")
            return

        # Remove rows for files no longer on disk.
        for path, row in list(existing.items()):
            if not os.path.exists(path):
                db.delete(row)
        db.commit()

        library.last_scanned_at = now()
        job.status = JobStatus.COMPLETED
        job.processed_files = completed
        job.progress = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, "Audio scan complete")

    except Exception as e:
        if job is not None:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        clear_cancel(job_id)
        db.close()
