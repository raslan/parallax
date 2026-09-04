import concurrent.futures as _cf
import json
import os
import subprocess
import threading
from datetime import UTC, datetime

from app.config import THUMBNAILS_DIR
from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobLog, JobStatus, JobType
from app.models.library import Library
from app.models.settings import get_setting
from app.services.common import arm_cancel, clear_cancel, should_cancel

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".m4v",
    ".mpg",
    ".mpeg",
    ".ts",
    ".m2ts",
    ".mts",
    ".vob",
    ".3gp",
    ".ogv",
    ".rmvb",
    ".divx",
}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def probe_file(path: str) -> dict:
    """Run ffprobe and return stream info dict, or {} on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,codec_type,duration,bit_rate,width,height,r_frame_rate",
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


def generate_thumbnail(file_path: str, file_id: int, duration: float | None = None) -> bool:
    """Extract a single frame at 10% into the video. Returns True on success.

    Removes any existing file at the target path first: `file_id` values get
    reused (SQLite rowid reuse after a delete), and `ffmpeg -y` only
    overwrites on a successful run — a failed extraction (e.g. a corrupt or
    fake video) would otherwise leave a stale thumbnail from a previously
    deleted, unrelated file sitting there and served under the new file's
    identity.

    `duration` lets a caller that already probed the file (scan/rescan/watcher
    all do) skip a second ffprobe subprocess just to find the seek point —
    pass it in whenever you have it. Only probes internally when omitted.
    """
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)
    out_path = os.path.join(THUMBNAILS_DIR, f"{file_id}.jpg")
    try:
        os.remove(out_path)
    except FileNotFoundError:
        pass

    try:
        if duration is None:
            data = probe_file(file_path)
            fmt = data.get("format", {})
            if fmt.get("duration"):
                duration = float(fmt["duration"])
            elif data.get("streams"):
                for s in data["streams"]:
                    if s.get("duration"):
                        duration = float(s["duration"])
                        break

        seek = str(max(0, (duration or 60) * 0.1))

        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                seek,
                "-i",
                file_path,
                "-vframes",
                "1",
                "-vf",
                "scale=320:-1",
                "-q:v",
                "5",
                out_path,
            ],
            capture_output=True,
            timeout=30,
        )
        return result.returncode == 0 and os.path.exists(out_path)
    except Exception:
        return False


def _warm_thumbnails(library_id: int) -> None:
    """Background job: generate thumbnails for every file in this library
    still missing one, after a scan finishes.

    Scanning deliberately skips thumbnail generation (see scan_library) so the
    scan itself stays fast — but leaving it purely on-demand meant thumbnails
    only ever started generating once a user happened to open a page that
    renders them. This runs the same `get_or_create_thumbnail` a page view
    would trigger, for every file still missing one.

    Tracked as its own Job (JobType.THUMBNAIL_WARM) so it's visible on the
    Jobs page with real progress and can be cancelled — this previously ran
    as an untracked daemon thread with no Job row at all, invisible to the
    UI even though a large, freshly-thumbnail-less library could peg most of
    the host's CPU for minutes. Skips creating a job entirely if nothing is
    actually missing.
    """
    db = SessionLocal()
    job_id: int | None = None
    try:
        rows = (
            db.query(File.id, File.path, File.duration).filter(File.library_id == library_id).all()
        )
        missing = [
            (fid, path, duration)
            for fid, path, duration in rows
            if not os.path.exists(thumbnail_path(fid))
        ]
        if not missing:
            return

        job = Job(
            type=JobType.THUMBNAIL_WARM,
            status=JobStatus.RUNNING,
            library_id=library_id,
            total_files=len(missing),
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
        arm_cancel(job_id)

        def _one(file_id: int, path: str, duration: float | None) -> None:
            try:
                get_or_create_thumbnail(file_id, path, duration=duration)
            except Exception:
                pass

        completed = 0
        was_cancelled = False
        with _cf.ThreadPoolExecutor(
            max_workers=_THUMBNAIL_GEN_LIMIT, thread_name_prefix="thumb-warm"
        ) as pool:
            pending = {pool.submit(_one, fid, path, duration) for fid, path, duration in missing}
            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)
                completed += len(done)
                if should_cancel(job_id):
                    was_cancelled = True
                    for fut in pending:
                        fut.cancel()
                    _cf.wait(pending)
                    pending = set()
                job.processed_files = completed
                if not was_cancelled:
                    job.progress = min(99.0, completed / len(missing) * 100)
                db.commit()

        job.status = JobStatus.CANCELLED if was_cancelled else JobStatus.COMPLETED
        if not was_cancelled:
            job.progress = 100.0
        job.finished_at = _now()
        db.commit()
    except Exception:
        pass
    finally:
        if job_id is not None:
            clear_cancel(job_id)
        db.close()


def thumbnail_path(file_id: int) -> str:
    return os.path.join(THUMBNAILS_DIR, f"{file_id}.jpg")


def _thumbnail_failed_marker_path(file_id: int) -> str:
    return os.path.join(THUMBNAILS_DIR, f"{file_id}.jpg.failed")


_thumb_locks: dict[int, threading.Lock] = {}
_thumb_locks_guard = threading.Lock()

# Caps how many on-demand thumbnail generations run at once. Without this, a
# grid page renders a screenful of cards on mount — each mounts its own
# <img>, each fires its own request — and every one of them would spawn a
# concurrent ffmpeg process with no limit at all. On a 4-core box that's
# dozens of ffmpeg processes fighting over 4 cores, each taking dramatically
# longer than it would alone, which is what "no thumbnails for a minute, then
# a slow trickle" looks like. Half the cores (not cores-1) — this pool is
# shared with the post-scan warm-up pass (_warm_thumbnails), which can queue
# thousands of files at once on a fresh library; leaving only one core free
# still let a big warm-up saturate the host and starve the API/event loop.
_THUMBNAIL_GEN_LIMIT = max(1, (os.cpu_count() or 4) // 2)
_thumbnail_gen_semaphore = threading.Semaphore(_THUMBNAIL_GEN_LIMIT)


def _lock_for_thumbnail(file_id: int) -> threading.Lock:
    with _thumb_locks_guard:
        lock = _thumb_locks.get(file_id)
        if lock is None:
            lock = threading.Lock()
            _thumb_locks[file_id] = lock
        return lock


def clear_thumbnail_failed_marker(file_id: int) -> None:
    """Clear a prior generation-failure marker — call this whenever a file's
    bytes actually change (rescan_file, watcher) so a fixed/replaced file
    gets a fresh attempt instead of staying permanently skipped."""
    try:
        os.remove(_thumbnail_failed_marker_path(file_id))
    except FileNotFoundError:
        pass


def get_or_create_thumbnail(
    file_id: int, file_path: str, duration: float | None = None
) -> str | None:
    """Return the on-disk thumbnail path for a file, generating it on first
    request if it doesn't exist yet. Returns None if generation is known to
    have failed (a `.failed` marker is present) or fails now — callers should
    treat None as "no thumbnail available," same as a missing file today.

    Thumbnail generation at scan time is deliberately skipped for video (see
    scan_library) since it's the heaviest per-file step and isn't needed
    until something actually looks at the file; this is where it happens
    instead, on first view. A per-file lock prevents two concurrent requests
    for the same missing thumbnail from spawning duplicate ffmpeg calls.
    """
    out_path = thumbnail_path(file_id)
    if os.path.exists(out_path):
        return out_path
    if os.path.exists(_thumbnail_failed_marker_path(file_id)):
        return None

    with _lock_for_thumbnail(file_id):
        # Re-check after acquiring the lock — another thread may have just
        # finished (or failed) generating this exact thumbnail.
        if os.path.exists(out_path):
            return out_path
        if os.path.exists(_thumbnail_failed_marker_path(file_id)):
            return None

        with _thumbnail_gen_semaphore:
            if generate_thumbnail(file_path, file_id, duration=duration):
                return out_path

            os.makedirs(THUMBNAILS_DIR, exist_ok=True)
            open(_thumbnail_failed_marker_path(file_id), "a").close()
            return None


def _probe_metadata(path: str) -> dict:
    """Probe a video file and return a flat dict of File-column values.

    Shared by `rescan_file`, `scan_library`, and `fs_watcher.py` so the
    ffprobe-field-mapping logic (and its edge cases — fraction fps, missing
    creation_time, etc.) lives in exactly one place. Does not touch the DB;
    callers assign the returned values onto their own `File` row.
    """
    result: dict = {
        "size": None,
        "duration": None,
        "codec_name": None,
        "video_bitrate": None,
        "file_width": None,
        "file_height": None,
        "file_fps": None,
        # False means ffprobe failed outright — callers updating an existing
        # row should leave the metadata fields above untouched rather than
        # null them out over a transient probe failure.
        "probe_ok": False,
    }

    try:
        result["size"] = os.stat(path).st_size
    except OSError:
        pass

    data = probe_file(path)
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
                    result["video_bitrate"] = int(br)
                except (ValueError, TypeError):
                    pass

            result["file_width"] = s.get("width")
            result["file_height"] = s.get("height")

            raw_fps = s.get("r_frame_rate", "")
            if "/" in raw_fps:
                num, den = raw_fps.split("/")
                result["file_fps"] = round(int(num) / int(den), 3) if int(den) else None
            elif raw_fps:
                result["file_fps"] = float(raw_fps)

    creation_time_str = (
        data.get("format", {}).get("tags", {}).get("creation_time") if data else None
    )
    file_mtime = os.path.getmtime(path)
    file_date = file_mtime
    if creation_time_str:
        try:
            dt = datetime.fromisoformat(creation_time_str.replace("Z", "+00:00"))
            file_date = dt.timestamp()
        except (ValueError, TypeError):
            pass

    result["file_mtime"] = file_mtime
    result["file_date"] = file_date
    return result


def rescan_file(db, file_obj: File) -> None:
    """Re-probe metadata and regenerate the thumbnail for one file already in the DB.

    Used right after something changes a file's bytes in place (Compress, Toolbox,
    restoring from _originals/) so the record reflects the new file immediately
    instead of waiting on the filesystem watcher's debounce to notice. Does not
    touch `status` — callers that need to reset it (e.g. restore) do so
    themselves.
    """
    path = file_obj.path
    meta = _probe_metadata(path)
    if meta["size"] is not None:
        file_obj.size = meta["size"]
    if meta["probe_ok"]:
        # Deliberately excludes file_mtime/file_date: rewriting the file
        # in-place (Compress, Toolbox, restore) changes the OS mtime for real,
        # but re-reading it here would make "File added" jump to whenever
        # Parallax last re-encoded the file instead of staying at the value
        # from the original scan — not what that filter is for.
        for key in (
            "duration",
            "codec_name",
            "video_bitrate",
            "file_width",
            "file_height",
            "file_fps",
        ):
            setattr(file_obj, key, meta[key])

    file_obj.scanned_at = _now()
    clear_thumbnail_failed_marker(file_obj.id)
    generate_thumbnail(path, file_obj.id, duration=meta["duration"])
    db.commit()


def _find_video_files(library_path: str) -> list[str]:
    paths = []
    for root, dirs, files in os.walk(library_path):
        dirs[:] = [d for d in dirs if d != "_originals"]
        for name in files:
            if os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS:
                paths.append(os.path.join(root, name))
    return sorted(paths)


def _log(db, job_id: int, message: str, level: str = "info"):
    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()


def scan_library(library_id: int):
    """Background task: discover files, probe metadata, generate thumbnails."""
    db = SessionLocal()
    job = None
    try:
        library: Library = db.get(Library, library_id)
        if not library:
            return

        job = Job(
            type=JobType.SCAN,
            status=JobStatus.RUNNING,
            library_id=library_id,
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        _log(db, job.id, f"Scanning library: {library.path}")
        video_paths = _find_video_files(library.path)

        # File walk is done — check cancellation and library existence before
        # entering the slow per-file loop (library may have been deleted during walk)
        db.expire_all()
        if db.get(Library, library_id) is None:
            job.status = JobStatus.CANCELLED
            job.error = "Library was deleted"
            job.finished_at = _now()
            db.commit()
            return

        arm_cancel(job.id)
        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "Scan cancelled")
            clear_cancel(job.id)
            return

        job.total_files = len(video_paths)
        db.commit()
        _log(db, job.id, f"Found {len(video_paths)} video files")

        existing = {f.path: f for f in db.query(File).filter(File.library_id == library_id).all()}

        # Phase 1 (sequential, DB-only): make sure every discovered path has a
        # File row before any concurrent work starts, so worker threads below
        # never touch the ORM/session — they only ever get a plain (id, path).
        # New rows are batched into a single insert + single commit instead of
        # one round-trip per file — on a fresh library of thousands of files
        # this was previously the dominant cost, paid entirely before the
        # parallel probe/thumbnail phase could even start.
        new_paths = [p for p in video_paths if p not in existing]
        if new_paths:
            # One existence/cancellation check covering the whole batch insert,
            # not one per file — if the library is deleted in the narrow window
            # between this check and the commit below, FK enforcement
            # (PRAGMA foreign_keys=ON) rejects the insert and the scan fails
            # loudly via the outer except, rather than silently no-op'ing.
            db.expire_all()
            if db.get(Library, library_id) is None or should_cancel(job.id):
                job.status = JobStatus.CANCELLED
                job.finished_at = _now()
                db.commit()
                clear_cancel(job.id)
                return
            new_objs = [
                File(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower().lstrip("."),
                    status=FileStatus.UNKNOWN,
                )
                for path in new_paths
            ]
            db.add_all(new_objs)
            db.commit()
            for obj in new_objs:
                existing[obj.path] = obj

        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "Scan cancelled")
            clear_cancel(job.id)
            return

        by_id: dict[int, File] = {existing[p].id: existing[p] for p in video_paths}

        # Phase 2 (parallel, I/O-bound): ffprobe metadata per file. Thumbnail
        # generation deliberately does NOT happen here — it's the heaviest
        # per-file step (a real ffmpeg seek+decode) and isn't needed until
        # something actually looks at the file, so it's deferred to first
        # request (see get_or_create_thumbnail, used by GET /files/{id}/thumbnail).
        # subprocess.run releases the GIL while ffprobe is running, so a small
        # thread pool still parallelizes real wall-clock work — same pattern
        # (and same setting) as duplicates.py's pHash extraction.
        work_items = [(fid, f.path) for fid, f in by_id.items()]
        n_concurrent = max(1, int(get_setting(db, "scan_prefetch", "4")))

        def _scan_one(file_id: int, path: str) -> tuple[int, dict | None, str | None]:
            try:
                return file_id, _probe_metadata(path), None
            except Exception as exc:
                return file_id, None, str(exc)

        was_cancelled = False
        completed = 0
        with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
            pending = {pool.submit(_scan_one, fid, path) for fid, path in work_items}

            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)

                if should_cancel(job.id):
                    was_cancelled = True
                    for fut in pending:
                        fut.cancel()
                    _cf.wait(pending)
                    pending = set()

                for fut in done:
                    try:
                        fid, meta, err = fut.result()
                    except _cf.CancelledError:
                        continue
                    if meta is None:
                        _log(db, job.id, f"Failed to scan {by_id[fid].filename}: {err}", "warning")
                    else:
                        file_obj = by_id[fid]
                        if meta["size"] is not None:
                            file_obj.size = meta["size"]
                        if meta["probe_ok"]:
                            for key in (
                                "duration",
                                "codec_name",
                                "video_bitrate",
                                "file_width",
                                "file_height",
                                "file_fps",
                            ):
                                setattr(file_obj, key, meta[key])
                        file_obj.file_mtime = meta["file_mtime"]
                        file_obj.file_date = meta["file_date"]
                        file_obj.scanned_at = _now()
                    completed += 1

                job.processed_files = completed
                job.progress = completed / len(work_items) * 100 if work_items else 100.0
                db.commit()

        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "Scan cancelled")
            clear_cancel(job.id)
            return

        clear_cancel(job.id)

        # Remove DB records for files no longer on disk
        for path, file_obj in existing.items():
            if not os.path.exists(path):
                try:
                    os.remove(thumbnail_path(file_obj.id))
                except FileNotFoundError:
                    pass
                clear_thumbnail_failed_marker(file_obj.id)
                db.delete(file_obj)
        db.commit()

        library.last_scanned_at = _now()
        job.status = JobStatus.COMPLETED
        job.finished_at = _now()
        job.progress = 100.0
        db.commit()
        _log(db, job.id, "Scan complete")

        threading.Thread(
            target=_warm_thumbnails, args=(library_id,), daemon=True, name="thumb-warm-dispatch"
        ).start()

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
            db.commit()
    finally:
        db.close()
