import os
import subprocess
import json
from datetime import datetime, timezone

from app.config import THUMBNAILS_DIR
from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobLog, JobType
from app.models.library import Library
from app.services.common import arm_cancel, should_cancel, clear_cancel


VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm",
    ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".mts", ".vob",
    ".3gp", ".ogv", ".rmvb", ".divx",
}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def probe_file(path: str) -> dict:
    """Run ffprobe and return stream info dict, or {} on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_type,duration",
                "-show_entries", "format=size,duration",
                "-of", "json",
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


def generate_thumbnail(file_path: str, file_id: int) -> bool:
    """Extract a single frame at 10% into the video. Returns True on success."""
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)
    out_path = os.path.join(THUMBNAILS_DIR, f"{file_id}.jpg")

    try:
        # Get duration first
        data = probe_file(file_path)
        duration = None
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
                "ffmpeg", "-y",
                "-ss", seek,
                "-i", file_path,
                "-vframes", "1",
                "-vf", "scale=320:-1",
                "-q:v", "5",
                out_path,
            ],
            capture_output=True,
            timeout=30,
        )
        return result.returncode == 0 and os.path.exists(out_path)
    except Exception:
        return False


def thumbnail_path(file_id: int) -> str:
    return os.path.join(THUMBNAILS_DIR, f"{file_id}.jpg")


def _find_video_files(library_path: str) -> list[str]:
    paths = []
    for root, _, files in os.walk(library_path):
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

        for i, path in enumerate(video_paths):
            if should_cancel(job.id):
                job.status = JobStatus.CANCELLED
                job.finished_at = _now()
                db.commit()
                _log(db, job.id, "Scan cancelled")
                clear_cancel(job.id)
                return

            file_obj = existing.get(path)
            if not file_obj:
                file_obj = File(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    status=FileStatus.UNKNOWN,
                )
                db.add(file_obj)
                db.commit()
                db.refresh(file_obj)

            try:
                stat = os.stat(path)
                file_obj.size = stat.st_size
            except OSError:
                pass

            data = probe_file(path)
            if data:
                fmt = data.get("format", {})
                if fmt.get("duration"):
                    file_obj.duration = float(fmt["duration"])
                if fmt.get("size"):
                    file_obj.size = int(fmt["size"])

            file_obj.scanned_at = _now()
            db.commit()

            generate_thumbnail(path, file_obj.id)

            job.processed_files = i + 1
            job.progress = (i + 1) / len(video_paths) * 100
            db.commit()

        clear_cancel(job.id)

        # Remove DB records for files no longer on disk
        for path, file_obj in existing.items():
            if not os.path.exists(path):
                db.delete(file_obj)
        db.commit()

        library.last_scanned_at = _now()
        job.status = JobStatus.COMPLETED
        job.finished_at = _now()
        job.progress = 100.0
        db.commit()
        _log(db, job.id, "Scan complete")

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = _now()
            db.commit()
    finally:
        db.close()
