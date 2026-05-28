import json
import os
import shutil
import numpy as np

from app.database import SessionLocal, DATA_DIR
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.models.video import VideoDetection
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel

KEYFRAME_DIR = os.path.join(DATA_DIR, "video-keyframes")


def keyframe_dir_for(file_id: int) -> str:
    return os.path.join(KEYFRAME_DIR, str(file_id))


def delete_keyframes(file_id: int) -> None:
    d = keyframe_dir_for(file_id)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)


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
        num_frames = int(get_setting(db, "video_keyframes_per_video", "8"))
        batch_size = int(get_setting(db, "scan_batch_size", "4"))

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        if reset:
            files = db.query(File).filter(File.library_id == library_id).all()
            for f in files:
                f.clip_embedding = None
                f.video_scanned_at = None
                db.query(VideoDetection).filter(VideoDetection.file_id == f.id).delete()
                delete_keyframes(f.id)
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

        from app.services.image_analyzer import encode_image_clip_batch, run_nudenet_batch

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

            try:
                frame_dir = keyframe_dir_for(file_obj.id)
                _, frames = extract_keyframes(
                    file_obj.path,
                    num_frames=num_frames,
                    dest_dir=frame_dir,
                )

                if not frames:
                    raise ValueError("No frames extracted from video")

                frame_paths = [fp for fp, _ in frames]

                if run_clip and frame_paths:
                    # Batch CLIP over all keyframes, then average into one video embedding
                    embeddings = encode_image_clip_batch(frame_paths, model_id=clip_model_id)
                    avg = np.mean(np.array(embeddings, dtype=np.float64), axis=0)
                    norm = np.linalg.norm(avg)
                    if norm > 0:
                        avg = avg / norm
                    file_obj.clip_embedding = json.dumps(avg.tolist())

                if run_nudenet and frames:
                    db.query(VideoDetection).filter(VideoDetection.file_id == file_obj.id).delete()
                    # Batch NudeNet over keyframes in chunks of batch_size
                    for chunk_start in range(0, len(frames), batch_size):
                        chunk = frames[chunk_start:chunk_start + batch_size]
                        chunk_paths = [fp for fp, _ in chunk]
                        chunk_ts = [ts for _, ts in chunk]
                        batch_dets = run_nudenet_batch(chunk_paths, model_id=nudenet_model_id)
                        for detections, ts in zip(batch_dets, chunk_ts):
                            for d in detections:
                                if d["confidence"] >= 0.5:
                                    db.add(VideoDetection(
                                        file_id=file_obj.id,
                                        timestamp_secs=ts,
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
