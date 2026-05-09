import subprocess
import time
from typing import Callable

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.services.common import arm_cancel, should_cancel, clear_cancel, now, log

_CANCELLED = "__cancelled__"


def check_corruption(
    path: str,
    timeout: int = 300,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[bool, str]:
    """
    Run ffmpeg -v error -f null - on path.
    Returns (is_corrupt, error_text). error_text == _CANCELLED if cancelled.
    """
    try:
        proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-nostats", "-i", path, "-f", "null", "-"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + timeout
        while proc.poll() is None:
            if cancel_check and cancel_check():
                proc.kill()
                proc.wait()
                return False, _CANCELLED
            if time.monotonic() > deadline:
                proc.kill()
                proc.wait()
                return True, "ffmpeg timed out"
            time.sleep(0.5)

        stderr = proc.stderr.read().strip()
        if not stderr:
            return False, ""
        # Exclude [null @ ...] lines — those come from the null muxer sink,
        # not from the actual decoders, and produce frequent false positives
        # (e.g. non-monotonic dts warnings on otherwise valid files).
        error_lines = [l for l in stderr.splitlines() if l.startswith("[") and not l.startswith("[null ")]
        return bool(error_lines), "\n".join(error_lines)
    except Exception as e:
        return True, str(e)


def _run_check_job(job: Job, files: list[File], db, library_id: int | None = None) -> None:
    """Inner loop shared by library and single-file check jobs."""
    job.total_files = len(files)
    db.commit()

    arm_cancel(job.id)

    # Check cancellation before entering the slow ffmpeg loop
    if should_cancel(job.id):
        job.status = JobStatus.CANCELLED
        job.finished_at = now()
        db.commit()
        log(db, job.id, "Check cancelled")
        clear_cancel(job.id)
        return

    # If this is a library job, verify the library wasn't deleted while queued
    if library_id is not None:
        db.expire_all()
        if db.get(Library, library_id) is None:
            job.status = JobStatus.CANCELLED
            job.error = "Library was deleted"
            job.finished_at = now()
            db.commit()
            clear_cancel(job.id)
            return

    for i, file_obj in enumerate(files):
        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            db.commit()
            log(db, job.id, "Check cancelled")
            clear_cancel(job.id)
            return

        job.current_file = file_obj.filename
        file_obj.status = FileStatus.SCANNING
        db.commit()

        is_corrupt, errors = check_corruption(
            file_obj.path, cancel_check=lambda: should_cancel(job.id)
        )

        if errors == _CANCELLED:
            file_obj.status = FileStatus.UNKNOWN
            db.commit()
            job.status = JobStatus.CANCELLED
            job.current_file = None
            job.finished_at = now()
            db.commit()
            log(db, job.id, "Check cancelled")
            clear_cancel(job.id)
            return

        file_obj.status = FileStatus.CORRUPT if is_corrupt else FileStatus.CLEAN
        file_obj.scan_error = errors if is_corrupt else None
        file_obj.scanned_at = now()

        if is_corrupt:
            error_count = len([l for l in errors.splitlines() if l.startswith("[")])
            log(db, job.id, f"Corrupt: {file_obj.filename} ({error_count} error line(s))", level="warning")

        job.processed_files = i + 1
        job.progress = (i + 1) / len(files) * 100
        db.commit()

    clear_cancel(job.id)
    job.status = JobStatus.COMPLETED
    job.current_file = None
    job.finished_at = now()
    job.progress = 100.0
    db.commit()
    corrupt_count = sum(1 for f in files if f.status == FileStatus.CORRUPT)
    log(db, job.id, f"Check complete — {corrupt_count} corrupt file(s) found out of {len(files)}")


def check_library_corruption(library_id: int) -> None:
    """Background job: corruption-check every file in a library."""
    db = SessionLocal()
    job = None
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        job = Job(
            type=JobType.CHECK,
            status=JobStatus.RUNNING,
            library_id=library_id,
            started_at=now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        log(db, job.id, f"Checking library: {library.path}")

        files = (
            db.query(File)
            .filter(
                File.library_id == library_id,
                File.status.notin_([FileStatus.TRANSCODING, FileStatus.QUEUED]),
            )
            .all()
        )

        if not files:
            job.status = JobStatus.COMPLETED
            job.finished_at = now()
            db.commit()
            return

        _run_check_job(job, files, db, library_id=library_id)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        db.close()


def check_file(file_id: int) -> None:
    """Background job: corruption-check a single file."""
    db = SessionLocal()
    job = None
    try:
        file_obj = db.get(File, file_id)
        if not file_obj:
            return

        job = Job(
            type=JobType.CHECK,
            status=JobStatus.RUNNING,
            library_id=file_obj.library_id,
            started_at=now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        _run_check_job(job, [file_obj], db)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
