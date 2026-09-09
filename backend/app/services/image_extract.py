"""On-demand extraction for image libraries — the image-side mirror of video's
`duplicates.find_duplicates`: a click triggers a scoped background job that
fills in `phash` / NudeNet `ImageDetection` rows for images that don't have
them yet (e.g. rows the filesystem watcher inserted with metadata + thumbnail
only), then the page re-reads its normal endpoint.

Both jobs are extraction-only. `GET /images/duplicates` still clusters, and
Content Review still queries `ImageDetection` — this just populates the columns
those reads depend on.
"""

import concurrent.futures as _cf

from app.database import SessionLocal
from app.models.image import ImageDetection, ImageFile, ImageStatus
from app.models.job import Job, JobStatus
from app.models.settings import get_setting
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel


def _start(db, job_id: int) -> Job | None:
    job = db.get(Job, job_id)
    if not job or job.status == JobStatus.CANCELLED:
        return None
    job.status = JobStatus.RUNNING
    job.started_at = now()
    db.commit()
    arm_cancel(job_id)
    return job


def _finish(db, job: Job | None, *, cancelled: bool = False) -> None:
    if not job:
        return
    job.status = JobStatus.CANCELLED if cancelled else JobStatus.COMPLETED
    if not cancelled:
        job.progress = 100.0
    job.finished_at = now()
    clear_cancel(job.id)
    db.commit()


def _fail(db, job: Job | None, exc: Exception) -> None:
    if job:
        job.status = JobStatus.FAILED
        job.error = str(exc)
        job.finished_at = now()
        db.commit()


def extract_image_phash(library_id: int | None, job_id: int) -> None:
    """Compute `phash` for every non-quarantined image missing one. `library_id`
    None → across every image library (the Image Duplicates page is not
    library-scoped)."""
    from app.services.image_scanner import _load_image_for_scan, _phash_from_array

    db = SessionLocal()
    job = None
    try:
        job = _start(db, job_id)
        if job is None:
            return

        q = db.query(ImageFile.id, ImageFile.path).filter(
            ImageFile.phash.is_(None),
            ImageFile.status != ImageStatus.QUARANTINED,
        )
        if library_id is not None:
            q = q.filter(ImageFile.library_id == library_id)
        rows = q.all()
        job.total_files = len(rows)
        db.commit()
        if not rows:
            _finish(db, job)
            return

        workers = max(1, int(get_setting(db, "scan_prefetch", "4")))

        def _one(image_id: int, path: str) -> tuple[int, int | None]:
            loaded = _load_image_for_scan(path, 400)
            if loaded is None:
                return image_id, None
            _meta, arr = loaded
            return image_id, _phash_from_array(arr)

        processed = 0
        with _cf.ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {pool.submit(_one, rid, p) for rid, p in rows}
            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)
                if should_cancel(job_id):
                    for f in pending:
                        f.cancel()
                    _cf.wait(pending)
                    _finish(db, job, cancelled=True)
                    return
                for f in done:
                    image_id, ph = f.result()
                    if ph is not None:
                        img = db.get(ImageFile, image_id)
                        if img is not None:
                            img.phash = ph
                    processed += 1
                job.processed_files = processed
                job.progress = processed / len(rows) * 100
                db.commit()
        _finish(db, job)
    except Exception as exc:  # noqa: BLE001 — job failure is reported on the row
        _fail(db, job, exc)
    finally:
        db.close()


def scan_image_content(library_id: int | None, job_id: int) -> None:
    """Run NudeNet on every non-quarantined image with no `ImageDetection` rows
    yet, writing detections and marking the row SCANNED. `library_id=None`
    scans across every image library (Content Review is not library-scoped)."""
    from app.services.image_analyzer import run_nudenet_batch_arrays
    from app.services.image_scanner import _load_image_for_scan
    from app.services.model_manager import NUDENET_MODELS

    db = SessionLocal()
    job = None
    try:
        job = _start(db, job_id)
        if job is None:
            return

        model_id = get_setting(db, "nudenet_model", "320n")
        batch_size = max(1, int(get_setting(db, "scan_batch_size", "4")))
        res = NUDENET_MODELS.get(model_id, {}).get("inference_resolution", 320)
        load_size = max(res, 400)
        workers = max(1, int(get_setting(db, "scan_prefetch", "4")))

        q = db.query(ImageFile.id, ImageFile.path).filter(
            ImageFile.status != ImageStatus.QUARANTINED,
            ImageFile.content_scanned_at.is_(None),
        )
        if library_id is not None:
            q = q.filter(ImageFile.library_id == library_id)
        rows = q.all()
        job.total_files = len(rows)
        db.commit()
        if not rows:
            _finish(db, job)
            return

        def _infer_write(ids: list[int], arrays: list) -> None:
            if not arrays:
                return
            try:
                batch_dets = run_nudenet_batch_arrays(arrays, model_id=model_id)
            except Exception as exc:  # noqa: BLE001
                log(db, job_id, f"NudeNet batch failed — {exc}", level="error")
                return
            for image_id, detections in zip(ids, batch_dets):
                for d in detections:
                    db.add(
                        ImageDetection(
                            image_id=image_id,
                            label=d["label"],
                            confidence=d["confidence"],
                            bbox_json=d["bbox_json"],
                        )
                    )
                img = db.get(ImageFile, image_id)
                if img is not None:
                    img.content_scanned_at = now()
                    if img.status == ImageStatus.PENDING:
                        img.status = ImageStatus.SCANNED
            db.commit()

        processed = 0
        batch_ids: list[int] = []
        batch_arr: list = []
        with _cf.ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_load_image_for_scan, p, load_size): rid for rid, p in rows}
            for fut in _cf.as_completed(futs):
                if should_cancel(job_id):
                    for f in futs:
                        f.cancel()
                    _finish(db, job, cancelled=True)
                    return
                loaded = fut.result()
                if loaded is not None:
                    _meta, arr = loaded
                    batch_ids.append(futs[fut])
                    batch_arr.append(arr)
                if len(batch_arr) >= batch_size:
                    _infer_write(batch_ids, batch_arr)
                    processed += len(batch_ids)
                    batch_ids, batch_arr = [], []
                    job.processed_files = processed
                    job.progress = processed / len(rows) * 100
                    db.commit()
        _infer_write(batch_ids, batch_arr)
        processed += len(batch_ids)
        job.processed_files = processed
        db.commit()
        _finish(db, job)
    except Exception as exc:  # noqa: BLE001
        _fail(db, job, exc)
    finally:
        from app.services.image_analyzer import release_sessions

        release_sessions()
        db.close()
