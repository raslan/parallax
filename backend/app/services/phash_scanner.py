import json
import os
import subprocess
import numpy as np
import imagehash
from PIL import Image

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus
from app.models.library import Library
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel
from app.services.video_analyzer import get_video_duration, _probe_video_dims, _hwaccel_args, _calc_scaled_size

_PHASH_FRAMES = 16
_PHASH_MAX_RES = 256


def _phash_int(arr: np.ndarray) -> int:
    val = int(str(imagehash.phash(Image.fromarray(arr))), 16)
    return val - 2**64 if val >= 2**63 else val


def _extract_phash_frames(video_path: str, n_frames: int) -> list[int]:
    """
    Fast seeks at n evenly-spaced timestamps (avoiding t=0 and end).
    Capped at 480p — pHash only needs 8x8 DCT, higher res wastes pipe bandwidth.
    No temp files, no full decode.
    """
    duration = get_video_duration(video_path)
    dims = _probe_video_dims(video_path)
    if not duration or duration <= 0 or not dims:
        raise ValueError("Could not probe video")

    out_w, out_h = _calc_scaled_size(dims[0], dims[1], _PHASH_MAX_RES)
    frame_size = out_w * out_h * 3
    timestamps = [duration * (i + 1) / (n_frames + 1) for i in range(n_frames)]

    hashes = []
    for ts in timestamps:
        result = subprocess.run(
            [
                "ffmpeg", *_hwaccel_args(),
                "-ss", str(ts), "-i", video_path,
                "-frames:v", "1",
                "-vf", f"scale={out_w}:{out_h}",
                "-f", "rawvideo", "-pix_fmt", "rgb24",
                "pipe:1",
                "-hide_banner", "-loglevel", "error",
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0 and len(result.stdout) >= frame_size:
            arr = np.frombuffer(result.stdout[:frame_size], dtype=np.uint8).reshape((out_h, out_w, 3))
            hashes.append(_phash_int(arr))

    if not hashes:
        raise ValueError("No frames extracted")
    return hashes


def scan_phash_library(
    library_id: int,
    job_id: int,
    reset: bool = False,
) -> None:
    db = SessionLocal()
    job = None
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        if reset:
            files = db.query(File).filter(File.library_id == library_id).all()
            for f in files:
                f.phash            = None
                f.phash_frames     = None
                f.phash_scanned_at = None
            db.commit()
            log(db, job_id, f"Reset: cleared pHash data for {len(files)} files")

        candidates = (
            db.query(File)
            .filter(
                File.library_id == library_id,
                File.status.in_([FileStatus.CLEAN, FileStatus.DONE, FileStatus.UNKNOWN]),
                File.phash_scanned_at.is_(None),
            )
            .all()
        )

        total = len(candidates)
        job.total_files = total
        db.commit()

        if total == 0:
            log(db, job_id, "No unscanned files — pHash data already up to date")
            job.status      = JobStatus.COMPLETED
            job.progress    = 100.0
            job.finished_at = now()
            db.commit()
            return

        log(db, job_id, f"Scanning pHash for {total} videos ({_PHASH_FRAMES} frames each)")
        arm_cancel(job_id)

        succeeded = 0
        failed    = 0

        for i, file_obj in enumerate(candidates):
            if should_cancel(job_id):
                job.status      = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                return

            fname = file_obj.filename
            job.current_file    = fname
            job.progress        = i / total * 100
            job.processed_files = i + 1
            db.commit()

            try:
                hashes = _extract_phash_frames(file_obj.path, _PHASH_FRAMES)
                file_obj.phash            = hashes[0]
                file_obj.phash_frames     = json.dumps(hashes)
                file_obj.phash_scanned_at = now()
                db.commit()
                succeeded += 1
            except Exception as e:
                db.rollback()
                log(db, job_id, f"Failed: {fname} — {e}", level="error")
                failed += 1

        clear_cancel(job_id)
        job.status      = JobStatus.COMPLETED
        job.progress    = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"pHash scan complete — {succeeded} scanned, {failed} failed")

    except Exception as e:
        if job:
            job.status      = JobStatus.FAILED
            job.error       = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
