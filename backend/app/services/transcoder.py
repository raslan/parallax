import os
import shutil
import subprocess
import tempfile
import time
from typing import Callable

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.services.common import arm_cancel, should_cancel, clear_cancel, now, log
from app.services.encoder import encoder_for_codec, PRESETS


def _build_cmd(
    input_path: str,
    output_path: str,
    crf: int,
    source_codec: str | None = None,
    source_bitrate: int | None = None,
    reencode_audio: bool = False,
) -> list[str]:
    encoder = encoder_for_codec(source_codec)
    nvenc = encoder in ("h264_nvenc", "hevc_nvenc")
    is_hevc = encoder in ("hevc_nvenc", "libx265")

    if nvenc:
        video_args = ["-c:v", encoder, "-rc:v", "vbr", "-cq:v", str(crf), "-preset", "p5"]
    else:
        video_args = ["-c:v", encoder, "-crf", str(crf), "-preset", "slow"]

    # Constrain output bitrate to source so re-encoding efficient codecs to a
    # lower-efficiency target (e.g. HEVC → H.264) doesn't blow up file size.
    bitrate_args: list[str] = []
    if source_bitrate and source_bitrate > 0:
        maxrate = source_bitrate
        bufsize = source_bitrate * 2
        bitrate_args = ["-maxrate", str(maxrate), "-bufsize", str(bufsize)]

    # MP4/M4V/MOV require hvc1 tag to accept HEVC streams.
    out_ext = os.path.splitext(output_path)[1].lower()
    tag_args = ["-tag:v", "hvc1"] if is_hevc and out_ext in {".mp4", ".m4v", ".mov"} else []

    # When converting containers (e.g. WMV→MKV), WMA and other container-specific
    # audio codecs can't be safely stream-copied into the new container — re-encode
    # to AAC instead. For same-container transcodes, copy is safe and faster.
    audio_args = ["-c:a", "aac", "-b:a", "192k"] if reencode_audio else ["-c:a", "copy"]

    return [
        "ffmpeg", "-y",
        "-i", input_path,
        *video_args,
        *bitrate_args,
        *tag_args,
        *audio_args,
        "-progress", "pipe:1",
        "-nostats",
        output_path,
    ]


def _update_file_metadata(file_obj: File, path: str) -> None:
    from app.services.scanner import probe_file
    from datetime import datetime

    try:
        file_obj.size = os.path.getsize(path)
    except OSError:
        pass

    data = probe_file(path)
    if not data:
        return

    fmt = data.get("format", {})
    streams = data.get("streams", [])
    if fmt.get("duration"):
        file_obj.duration = float(fmt["duration"])
    if fmt.get("size"):
        file_obj.size = int(fmt["size"])
    if streams:
        s = streams[0]
        if s.get("codec_name"):
            file_obj.codec_name = s["codec_name"]
        br = s.get("bit_rate") or fmt.get("bit_rate")
        if br:
            try:
                file_obj.video_bitrate = int(br)
            except (ValueError, TypeError):
                pass
        file_obj.file_width = s.get("width")
        file_obj.file_height = s.get("height")
        raw_fps = s.get("r_frame_rate", "")
        if "/" in raw_fps:
            num, den = raw_fps.split("/")
            file_obj.file_fps = round(int(num) / int(den), 3) if int(den) else None

    creation_time_str = fmt.get("tags", {}).get("creation_time")
    if creation_time_str:
        try:
            dt = datetime.fromisoformat(creation_time_str.replace("Z", "+00:00"))
            file_obj.file_date = dt.timestamp()
        except (ValueError, TypeError):
            file_obj.file_date = os.path.getmtime(path)
    else:
        file_obj.file_date = os.path.getmtime(path)


def _transcode_one(
    file_obj: File,
    crf: int,
    job_id: int,
    db,
    progress_cb: Callable[[float], None] | None = None,
) -> bool:
    """
    Transcode a single file in-place. Original is moved to _originals/ on success.
    Returns True on success, False on failure or cancellation.
    """
    src = file_obj.path
    base, ext = os.path.splitext(src)
    encoder = encoder_for_codec(file_obj.codec_name)
    is_hevc_out = encoder in ("hevc_nvenc", "libx265")
    # These containers don't support H.264/HEVC, or use codecs (e.g. WMA) that
    # can't be safely stream-copied into MKV — remux and re-encode audio.
    _NEEDS_REMUX = {".webm", ".flv", ".avi", ".wmv"}
    # .m4v uses the ipod muxer which rejects HEVC regardless of tags; use .mp4 instead.
    if is_hevc_out and ext.lower() == ".m4v":
        out_ext = ".mp4"
        changing_container = True
    elif ext.lower() in _NEEDS_REMUX:
        out_ext = ".mkv"
        changing_container = True
    else:
        out_ext = ext.lower() or ".mkv"
        changing_container = False
    dst = src if out_ext == ext.lower() else (base + out_ext)
    tmp = base + ".transcoding" + out_ext
    duration = file_obj.duration or 0.0

    original_status = file_obj.status
    file_obj.status = FileStatus.TRANSCODING
    db.commit()

    proc = None
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="transcode_")
    try:
        proc = subprocess.Popen(
            _build_cmd(src, tmp, crf, file_obj.codec_name, file_obj.video_bitrate, reencode_audio=changing_container),
            stdout=subprocess.PIPE,
            stderr=err_fd,
            text=True,
        )
        os.close(err_fd)
        err_fd = -1

        last_commit = time.monotonic()
        for line in iter(proc.stdout.readline, ""):
            if should_cancel(job_id):
                proc.kill()
                proc.wait()
                _cleanup_tmp(tmp)
                _cleanup_tmp(err_path)
                file_obj.status = original_status
                db.commit()
                return False

            line = line.strip()
            if line.startswith("out_time_ms=") and duration > 0 and progress_cb:
                try:
                    ms = int(line.split("=")[1])
                    if ms > 0:
                        progress_cb(min(ms / 1_000_000 / duration, 0.99))
                        t = time.monotonic()
                        if t - last_commit >= 2.0:
                            db.commit()
                            last_commit = t
                except (ValueError, IndexError):
                    pass

        proc.wait()

        if proc.returncode != 0:
            stderr_text = _read_and_remove(err_path)
            _cleanup_tmp(tmp)
            file_obj.status = FileStatus.FAILED
            file_obj.scan_error = stderr_text[-1024:] if stderr_text else f"ffmpeg exit {proc.returncode}"
            db.commit()
            return False

        _cleanup_tmp(err_path)

        originals_dir = os.path.join(os.path.dirname(src), "_originals")
        os.makedirs(originals_dir, exist_ok=True)
        shutil.move(src, os.path.join(originals_dir, file_obj.filename))
        shutil.move(tmp, dst)

        file_obj.status = FileStatus.DONE
        file_obj.transcoded_at = now()
        if dst != src:
            file_obj.path = dst
            file_obj.filename = os.path.basename(dst)
            file_obj.extension = os.path.splitext(dst)[1].lower().lstrip(".")

        _update_file_metadata(file_obj, dst)
        db.commit()

        from app.services.scanner import generate_thumbnail
        generate_thumbnail(dst, file_obj.id)

        return True

    except Exception as e:
        if err_fd != -1:
            try:
                os.close(err_fd)
            except OSError:
                pass
        if proc:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass
        _cleanup_tmp(tmp)
        _cleanup_tmp(err_path)
        file_obj.status = FileStatus.FAILED
        file_obj.scan_error = str(e)
        db.commit()
        return False


def _cleanup_tmp(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _read_and_remove(path: str) -> str:
    try:
        with open(path) as f:
            text = f.read()
        os.remove(path)
        return text
    except OSError:
        return ""


def _run_transcode_job(
    job: Job,
    files: list[File],
    crf: int,
    db,
    library_id: int | None = None,
) -> None:
    total = len(files)
    job.total_files = total
    db.commit()

    arm_cancel(job.id)

    if should_cancel(job.id):
        job.status = JobStatus.CANCELLED
        job.finished_at = now()
        db.commit()
        log(db, job.id, "Transcode cancelled")
        clear_cancel(job.id)
        return

    if library_id is not None:
        db.expire_all()
        if db.get(Library, library_id) is None:
            job.status = JobStatus.CANCELLED
            job.error = "Library was deleted"
            job.finished_at = now()
            db.commit()
            clear_cancel(job.id)
            return

    succeeded = 0
    failed = 0

    for i, file_obj in enumerate(files):
        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            db.commit()
            log(db, job.id, "Transcode cancelled")
            clear_cancel(job.id)
            return

        def make_cb(idx: int, tot: int) -> Callable[[float], None]:
            def cb(frac: float) -> None:
                job.progress = (idx + frac) / tot * 100
            return cb

        ok = _transcode_one(file_obj, crf, job.id, db, progress_cb=make_cb(i, total))

        if ok:
            succeeded += 1
        elif not should_cancel(job.id):
            failed += 1
            log(db, job.id,
                f"Failed: {file_obj.filename} — {file_obj.scan_error or 'ffmpeg non-zero exit'}",
                level="error")

        job.processed_files = i + 1
        job.progress = (i + 1) / total * 100
        db.commit()

    clear_cancel(job.id)
    if failed > 0:
        job.error = f"{failed} of {total} file{'s' if total != 1 else ''} failed to transcode"
    job.status = JobStatus.FAILED if (failed > 0 and succeeded == 0) else JobStatus.COMPLETED
    job.finished_at = now()
    job.progress = 100.0
    db.commit()
    log(db, job.id, f"Transcode complete — {succeeded} succeeded, {failed} failed")


