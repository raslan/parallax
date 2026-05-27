import json
import os
import shutil

from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.models.video import VideoDetection
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel


def scan_video_library(
    library_id: int,
    job_id: int,
    run_clip: bool = True,
    run_nudenet: bool = True,
    reset: bool = False,
) -> None:
    from app.models.settings import get_setting
    from app.services.video_analyzer import extract_keyframes, embed_video_clip, detect_video_nudenet

    db = SessionLocal()
    job = None
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        clip_model_id = get_setting(db, "clip_model", "clip-vit-base-patch32")
        nudenet_model_id = get_setting(db, "nudenet_model", "320n")

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        if reset:
            files = db.query(File).filter(File.library_id == library_id).all()
            for f in files:
                f.clip_embedding = None
                f.video_scanned_at = None
                db.query(VideoDetection).filter(VideoDetection.file_id == f.id).delete()
            db.commit()
            log(db, job_id, f"Reset: cleared video scan data for {len(files)} files")

        candidates = (
            db.query(File)
            .filter(
                File.library_id == library_id,
                File.status.in_([FileStatus.CLEAN, FileStatus.DONE, FileStatus.UNKNOWN]),
                File.video_scanned_at.is_(None),
            )
            .all()
        )

        total = len(candidates)
        job.total_files = total
        db.commit()

        if total == 0:
            log(db, job_id, "No unscanned files — all files already have video scan data")
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.finished_at = now()
            db.commit()
            return

        log(db, job_id, f"Found {total} files to scan in {library.path}")
        arm_cancel(job_id)
        succeeded = failed = 0

        for i, file_obj in enumerate(candidates):
            if should_cancel(job_id):
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                return

            job.current_file = file_obj.filename
            job.progress = i / total * 100 if total else 100
            db.commit()

            tmpdir = None
            try:
                tmpdir, frames = extract_keyframes(file_obj.path)

                if not frames:
                    raise ValueError("No frames extracted from video")

                frame_paths = [fp for fp, _ in frames]

                if run_clip and frame_paths:
                    embedding = embed_video_clip(frame_paths, model_id=clip_model_id)
                    file_obj.clip_embedding = json.dumps(embedding)

                if run_nudenet and frames:
                    db.query(VideoDetection).filter(VideoDetection.file_id == file_obj.id).delete()
                    detections = detect_video_nudenet(frames, model_id=nudenet_model_id)
                    for d in detections:
                        db.add(VideoDetection(
                            file_id=file_obj.id,
                            timestamp_secs=d["timestamp_secs"],
                            label=d["label"],
                            confidence=d["confidence"],
                        ))

                file_obj.video_scanned_at = now()
                db.commit()
                succeeded += 1

            except Exception as e:
                db.rollback()
                log(db, job_id, f"Failed: {file_obj.filename} — {e}", level="error")
                failed += 1

            finally:
                if tmpdir and os.path.isdir(tmpdir):
                    shutil.rmtree(tmpdir, ignore_errors=True)

            job.processed_files = i + 1
            db.commit()

        clear_cancel(job_id)
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Video scan complete — {succeeded} scanned, {failed} failed")

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        from app.services.image_analyzer import release_sessions
        release_sessions()
        db.close()
