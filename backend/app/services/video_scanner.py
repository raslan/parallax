import json
import os
import shutil
import numpy as np
import imagehash
from PIL import Image

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
    from app.services.video_analyzer import extract_keyframes

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
                f.phash = None
                f.phash_frames = None
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

        from app.services.image_analyzer import encode_image_clip_batch, run_nudenet_batch

        # ── Phase 1: Keyframe extraction + pHash (0–40%) ────────────────────
        if job:
            job.current_file = "Extracting keyframes…"
            db.commit()
        # scan_data: (file_obj, [frame_path, ...], [timestamp, ...]) per success
        scan_data: list[tuple[File, list[str], list[float]]] = []
        failed = 0

        for i, file_obj in enumerate(candidates):
            if should_cancel(job_id):
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                return

            job.current_file = file_obj.filename
            job.progress = i / total * 40
            job.processed_files = i + 1
            db.commit()

            try:
                frame_dir = keyframe_dir_for(file_obj.id)
                delete_keyframes(file_obj.id)
                _, frames = extract_keyframes(
                    file_obj.path,
                    num_frames=num_frames,
                    dest_dir=frame_dir,
                )

                if not frames:
                    raise ValueError("No frames extracted from video")

                frame_paths = [fp for fp, _ in frames]
                timestamps = [ts for _, ts in frames]

                frame_hashes = []
                for fp in frame_paths:
                    try:
                        with Image.open(fp) as img:
                            h = imagehash.phash(img)
                            val = int(str(h), 16)
                            frame_hashes.append(val - 2**64 if val >= 2**63 else val)
                    except Exception:
                        pass
                if frame_hashes:
                    file_obj.phash = frame_hashes[0]
                    file_obj.phash_frames = json.dumps(frame_hashes)
                    db.commit()

                scan_data.append((file_obj, frame_paths, timestamps))

            except Exception as e:
                db.rollback()
                log(db, job_id, f"Failed: {file_obj.filename} — {e}", level="error")
                failed += 1

        # ── Phase 2: Batched CLIP across all videos (40–70%) ────────────────
        if job:
            job.current_file = "Running semantic scan (CLIP)…"
            db.commit()
        # Flatten frames, run in batch_size chunks, reattribute by video count.
        if run_clip and scan_data:
            all_clip_paths: list[str] = []
            video_frame_counts: list[int] = []
            for _, frame_paths, _ in scan_data:
                all_clip_paths.extend(frame_paths)
                video_frame_counts.append(len(frame_paths))

            all_embeddings: list[list[float]] = []
            n_batches = max(1, (len(all_clip_paths) + batch_size - 1) // batch_size)
            for bi, chunk_start in enumerate(range(0, len(all_clip_paths), batch_size)):
                if should_cancel(job_id):
                    job.status = JobStatus.CANCELLED
                    job.finished_at = now()
                    db.commit()
                    clear_cancel(job_id)
                    return
                chunk = all_clip_paths[chunk_start:chunk_start + batch_size]
                all_embeddings.extend(encode_image_clip_batch(chunk, model_id=clip_model_id))
                job.progress = 40 + (bi + 1) / n_batches * 30
                db.commit()

            offset = 0
            for (file_obj, _, _), count in zip(scan_data, video_frame_counts):
                video_embs = all_embeddings[offset:offset + count]
                offset += count
                if not video_embs:
                    continue
                avg = np.mean(np.array(video_embs, dtype=np.float64), axis=0)
                norm = np.linalg.norm(avg)
                if norm > 0:
                    avg = avg / norm
                file_obj.clip_embedding = json.dumps(avg.tolist())
            db.commit()

        # ── Phase 3: Batched NudeNet across all videos (70–100%) ────────────
        if job:
            job.current_file = "Running content scan (NudeNet)…"
            db.commit()
        if run_nudenet and scan_data:
            nudenet_frames: list[tuple[File, str, float]] = []
            for file_obj, frame_paths, timestamps in scan_data:
                db.query(VideoDetection).filter(VideoDetection.file_id == file_obj.id).delete()
                for fp, ts in zip(frame_paths, timestamps):
                    nudenet_frames.append((file_obj, fp, ts))
            db.commit()

            n_batches = max(1, (len(nudenet_frames) + batch_size - 1) // batch_size)
            for bi, chunk_start in enumerate(range(0, len(nudenet_frames), batch_size)):
                if should_cancel(job_id):
                    job.status = JobStatus.CANCELLED
                    job.finished_at = now()
                    db.commit()
                    clear_cancel(job_id)
                    return
                chunk = nudenet_frames[chunk_start:chunk_start + batch_size]
                chunk_paths = [fp for _, fp, _ in chunk]
                batch_dets = run_nudenet_batch(chunk_paths, model_id=nudenet_model_id)
                for (file_obj, _, ts), detections in zip(chunk, batch_dets):
                    for d in detections:
                        if d["confidence"] >= 0.5:
                            db.add(VideoDetection(
                                file_id=file_obj.id,
                                timestamp_secs=ts,
                                label=d["label"],
                                confidence=d["confidence"],
                            ))
                db.commit()
                job.progress = 70 + (bi + 1) / n_batches * 29  # reserve last 1% for COMPLETED
                db.commit()

        # ── Finalize ─────────────────────────────────────────────────────────
        ts_now = now()
        for file_obj, _, _ in scan_data:
            file_obj.video_scanned_at = ts_now
        db.commit()

        clear_cancel(job_id)
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Video scan complete — {len(scan_data)} scanned, {failed} failed")

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
