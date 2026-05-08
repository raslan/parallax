import os
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Callable

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobLog, JobType
from app.models.library import Library
from app.services.common import arm_cancel, should_cancel, clear_cancel
from app.services.encoder import detect_encoder, PRESETS


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _log(db, job_id: int, message: str, level: str = "info") -> None:
    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()


def _build_cmd(input_path: str, output_path: str, crf: int) -> list[str]:
    encoder = detect_encoder()
    if encoder == "h264_nvenc":
        video_args = ["-c:v", "h264_nvenc", "-rc:v", "vbr", "-cq:v", str(crf), "-preset", "p5"]
    else:
        video_args = ["-c:v", "libx264", "-crf", str(crf), "-preset", "slow"]
    return [
        "ffmpeg", "-y",
        "-i", input_path,
        *video_args,
        "-c:a", "copy",
        "-progress", "pipe:1",
        "-nostats",
        output_path,
    ]


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
    tmp = src + ".transcoding"
    duration = file_obj.duration or 0.0

    file_obj.status = FileStatus.TRANSCODING
    db.commit()

    proc = None
    try:
        proc = subprocess.Popen(
            _build_cmd(src, tmp, crf),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )

        for line in iter(proc.stdout.readline, ""):
            if should_cancel(job_id):
                proc.kill()
                proc.wait()
                _cleanup_tmp(tmp)
                file_obj.status = FileStatus.CORRUPT
                db.commit()
                return False

            line = line.strip()
            if line.startswith("out_time_ms=") and duration > 0 and progress_cb:
                try:
                    ms = int(line.split("=")[1])
                    if ms > 0:
                        progress_cb(min(ms / 1_000_000 / duration, 0.99))
                except (ValueError, IndexError):
                    pass

        proc.wait()

        if proc.returncode != 0:
            _cleanup_tmp(tmp)
            file_obj.status = FileStatus.FAILED
            db.commit()
            return False

        # Move original to _originals/ backup folder
        originals_dir = os.path.join(os.path.dirname(src), "_originals")
        os.makedirs(originals_dir, exist_ok=True)
        shutil.move(src, os.path.join(originals_dir, file_obj.filename))

        # Put transcoded file at the original path
        shutil.move(tmp, src)

        file_obj.status = FileStatus.DONE
        file_obj.transcoded_at = _now()
        try:
            file_obj.size = os.path.getsize(src)
        except OSError:
            pass
        db.commit()
        return True

    except Exception as e:
        if proc:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass
        _cleanup_tmp(tmp)
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


def _run_transcode_job(
    job: Job,
    files: list[File],
    crf: int,
    db,
    library_id: int | None = None,
) -> None:
    job.total_files = len(files)
    db.commit()

    arm_cancel(job.id)

    if should_cancel(job.id):
        job.status = JobStatus.CANCELLED
        job.finished_at = _now()
        db.commit()
        _log(db, job.id, "Transcode cancelled")
        clear_cancel(job.id)
        return

    if library_id is not None:
        db.expire_all()
        if db.get(Library, library_id) is None:
            job.status = JobStatus.CANCELLED
            job.error = "Library was deleted"
            job.finished_at = _now()
            db.commit()
            clear_cancel(job.id)
            return

    succeeded = 0
    failed = 0

    for i, file_obj in enumerate(files):
        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "Transcode cancelled")
            clear_cancel(job.id)
            return

        total = len(files)

        def make_cb(idx, tot):
            def cb(frac):
                job.progress = (idx + frac) / tot * 100
                db.commit()
            return cb

        ok = _transcode_one(file_obj, crf, job.id, db, progress_cb=make_cb(i, total))

        if ok:
            succeeded += 1
        else:
            if not should_cancel(job.id):
                failed += 1

        job.processed_files = i + 1
        job.progress = (i + 1) / total * 100
        db.commit()

    clear_cancel(job.id)
    job.status = JobStatus.COMPLETED
    job.finished_at = _now()
    job.progress = 100.0
    db.commit()
    _log(db, job.id, f"Transcode complete — {succeeded} succeeded, {failed} failed")


def transcode_file(file_id: int, preset: str = "medium") -> None:
    """Background job: transcode a single file."""
    db = SessionLocal()
    job = None
    try:
        file_obj = db.get(File, file_id)
        if not file_obj:
            return

        crf = PRESETS.get(preset, PRESETS["medium"])
        job = Job(
            type=JobType.TRANSCODE,
            status=JobStatus.RUNNING,
            library_id=file_obj.library_id,
            settings=preset,
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        _log(db, job.id, f"Transcoding: {file_obj.filename} ({preset})")

        _run_transcode_job(job, [file_obj], crf, db)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
            db.commit()
    finally:
        db.close()


def transcode_library_corrupt(library_id: int, preset: str = "medium") -> None:
    """Background job: transcode all corrupt files in a library."""
    db = SessionLocal()
    job = None
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        crf = PRESETS.get(preset, PRESETS["medium"])
        job = Job(
            type=JobType.TRANSCODE,
            status=JobStatus.RUNNING,
            library_id=library_id,
            settings=preset,
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        _log(db, job.id, f"Transcoding corrupt files in library: {library.path} ({preset})")

        files = (
            db.query(File)
            .filter(File.library_id == library_id, File.status == FileStatus.CORRUPT)
            .all()
        )

        if not files:
            job.status = JobStatus.COMPLETED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "No corrupt files to transcode")
            return

        _run_transcode_job(job, files, crf, db, library_id=library_id)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
            db.commit()
    finally:
        db.close()
