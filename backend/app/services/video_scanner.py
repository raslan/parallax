import json
import queue as _queue
import threading
import numpy as np
from app.database import SessionLocal
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus
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
    from app.services.model_manager import CLIP_MODELS, NUDENET_MODELS
    from app.services.video_analyzer import extract_frames_evenly
    from app.services.image_analyzer import encode_image_clip_batch_arrays, run_nudenet_batch_arrays

    db = SessionLocal()
    job = None
    try:
        library = db.get(Library, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        clip_model_id    = get_setting(db, "clip_model",                   "clip-vit-base-patch32")
        nudenet_model_id = get_setting(db, "nudenet_model",                "320n")
        max_frames       = int(get_setting(db, "video_keyframes_per_video", "16"))
        batch_size       = int(get_setting(db, "scan_batch_size",           "4"))
        prefetch         = int(get_setting(db, "scan_prefetch",             "4"))

        clip_res    = CLIP_MODELS.get(clip_model_id,    {}).get("image_size",           224)
        nudenet_res = NUDENET_MODELS.get(nudenet_model_id, {}).get("inference_resolution", 320) if run_nudenet else 0
        extraction_resolution = max(clip_res, nudenet_res)

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        if reset:
            files = db.query(File).filter(File.library_id == library_id).all()
            for f in files:
                f.clip_embedding   = None
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
            job.status      = JobStatus.COMPLETED
            job.progress    = 100.0
            job.finished_at = now()
            db.commit()
            return

        log(db, job_id,
            f"Found {total} files to scan in {library.path} "
            f"(max {max_frames} frames @ {extraction_resolution}px, prefetch {prefetch})")
        arm_cancel(job_id)

        # Pre-extract path/filename from ORM objects — producer runs in a separate thread
        # and must not touch the main session.
        file_info = [(f.id, f.path, f.filename) for f in candidates]

        # Queue: (file_id, fname, frames_or_none) per video, or None sentinel.
        work_q: _queue.Queue = _queue.Queue(maxsize=prefetch)

        def producer() -> None:
            for file_id, path, fname in file_info:
                if should_cancel(job_id):
                    break
                try:
                    frames = extract_frames_evenly(
                        path,
                        n_frames=max_frames,
                        max_resolution=extraction_resolution,
                    )
                    work_q.put((file_id, fname, frames))
                except Exception as e:
                    print(f"[keyframes] {fname}: extraction failed — {e}", flush=True)
                    work_q.put((file_id, fname, None))
            work_q.put(None)

        prod = threading.Thread(target=producer, daemon=True)
        prod.start()

        succeeded = 0
        failed    = 0
        i         = 0

        while True:
            item = work_q.get()
            if item is None:
                break

            file_id, fname, frames = item

            if should_cancel(job_id):
                job.status      = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                prod.join(timeout=30)
                return

            file_obj = db.get(File, file_id)
            if not file_obj:
                i += 1
                continue

            job.current_file    = fname
            job.progress        = i / total * 100
            job.processed_files = i + 1
            db.commit()
            i += 1

            if not frames:
                log(db, job_id, f"Failed: {fname} — no frames extracted", level="error")
                failed += 1
                continue

            try:
                arrays     = [arr for arr, _ in frames]
                timestamps = [ts  for _, ts  in frames]

                # CLIP — 3 frames centred on the video midpoint.
                # Averaging across all frames dilutes the embedding for diverse content;
                # the middle region is most representative for uniform/tutorial/talking-head video.
                if run_clip:
                    mid = len(arrays) // 2
                    clip_arrays = arrays[max(0, mid - 1):mid + 2]
                    all_embs: list[list[float]] = []
                    for s in range(0, len(clip_arrays), batch_size):
                        all_embs.extend(
                            encode_image_clip_batch_arrays(clip_arrays[s:s + batch_size], model_id=clip_model_id)
                        )
                    if all_embs:
                        avg  = np.mean(np.array(all_embs, dtype=np.float64), axis=0)
                        norm = np.linalg.norm(avg)
                        if norm > 0:
                            avg = avg / norm
                        file_obj.clip_embedding = json.dumps(avg.tolist())

                # NudeNet — full frame spread for maximum coverage across the video
                if run_nudenet:
                    db.query(VideoDetection).filter(
                        VideoDetection.file_id == file_obj.id
                    ).delete()
                    for s in range(0, len(arrays), batch_size):
                        chunk_arrs = arrays[s:s + batch_size]
                        chunk_ts   = timestamps[s:s + batch_size]
                        for dets, ts in zip(
                            run_nudenet_batch_arrays(chunk_arrs, model_id=nudenet_model_id),
                            chunk_ts,
                        ):
                            for d in dets:
                                if d["confidence"] >= 0.5:
                                    db.add(VideoDetection(
                                        file_id=file_obj.id,
                                        timestamp_secs=ts,
                                        label=d["label"],
                                        confidence=d["confidence"],
                                    ))

                file_obj.video_scanned_at = now()
                db.commit()
                log(db, job_id, f"Scanned: {fname} ({len(frames)} frames)")
                succeeded += 1

            except Exception as e:
                db.rollback()
                log(db, job_id, f"Failed: {fname} — {e}", level="error")
                failed += 1

        prod.join(timeout=30)
        clear_cancel(job_id)
        job.status      = JobStatus.COMPLETED
        job.progress    = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Video scan complete — {succeeded} scanned, {failed} failed")

    except Exception as e:
        if job:
            job.status      = JobStatus.FAILED
            job.error       = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        from app.services.image_analyzer import release_sessions
        release_sessions()
        db.close()
