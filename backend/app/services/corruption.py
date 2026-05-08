import subprocess
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobLog, JobType
from app.models.library import Library
from app.services.common import arm_cancel, should_cancel, clear_cancel


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _log(db, job_id: int, message: str, level: str = "info") -> None:
    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()


def check_corruption(path: str, timeout: int = 300) -> tuple[bool, str]:
    """
    Run ffmpeg -v error -f null - on path.
    Returns (is_corrupt, error_text).
    """
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-nostats", "-i", path, "-f", "null", "-"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stderr = result.stderr.strip()
        if not stderr:
            return False, ""
        # Only lines starting with '[' are ffmpeg diagnostic messages
        error_lines = [l for l in stderr.splitlines() if l.startswith("[")]
        return bool(error_lines), "\n".join(error_lines)
    except subprocess.TimeoutExpired:
        return True, "ffmpeg timed out"
    except Exception as e:
        return True, str(e)


def _run_check_job(job: Job, files: list[File], db) -> None:
    """Inner loop shared by library and single-file check jobs."""
    job.total_files = len(files)
    db.commit()

    arm_cancel(job.id)

    for i, file_obj in enumerate(files):
        if should_cancel(job.id):
            job.status = JobStatus.CANCELLED
            job.finished_at = _now()
            db.commit()
            _log(db, job.id, "Check cancelled")
            clear_cancel(job.id)
            return

        file_obj.status = FileStatus.SCANNING
        db.commit()

        is_corrupt, errors = check_corruption(file_obj.path)

        file_obj.status = FileStatus.CORRUPT if is_corrupt else FileStatus.CLEAN
        file_obj.scan_error = errors if is_corrupt else None
        file_obj.scanned_at = _now()

        job.processed_files = i + 1
        job.progress = (i + 1) / len(files) * 100
        db.commit()

    clear_cancel(job.id)
    job.status = JobStatus.COMPLETED
    job.finished_at = _now()
    job.progress = 100.0
    db.commit()
    _log(db, job.id, f"Check complete — {sum(1 for f in files if f.status == FileStatus.CORRUPT)} corrupt file(s) found")


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
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        _log(db, job.id, f"Checking library: {library.path}")

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
            job.finished_at = _now()
            db.commit()
            return

        _run_check_job(job, files, db)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
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
            started_at=_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        _run_check_job(job, [file_obj], db)

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
            db.commit()
    finally:
        db.close()
