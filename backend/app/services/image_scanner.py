import concurrent.futures as _cf
import contextlib
import json
import os
import queue as _queue
import struct
import threading

import imagehash
import numpy as np
from PIL import ExifTags, Image

from app.database import DATA_DIR, SessionLocal
from app.models.image import ImageDetection, ImageFile, ImageStatus
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.services.common import (
    arm_cancel,
    clear_cancel,
    fail_job,
    library_scan_active,
    log,
    now,
    should_cancel,
)

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
THUMBNAIL_DIR = os.path.join(DATA_DIR, "image-thumbnails")
THUMBNAIL_SIZE = (400, 400)


def collect_image_paths(root: str) -> list[str]:
    paths = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith("_")]
        for filename in files:
            if os.path.splitext(filename)[1].lower() in SUPPORTED_EXTENSIONS:
                paths.append(os.path.join(dirpath, filename))
    return paths


def _thumbnail_path(image_id: int) -> str:
    return os.path.join(THUMBNAIL_DIR, f"{image_id}.jpg")


def _load_image_for_scan(
    path: str,
    load_size: int,
    decode: bool = True,
) -> tuple[dict, np.ndarray | None] | None:
    """
    Open image once: extract metadata from header, decode at reduced resolution.
    Uses PIL draft() for JPEG (DCT-domain downsampling — no full-res decode).
    `decode=False` stops after the header/EXIF read (array is None) for callers
    with no pixel work to do. Returns (meta_dict, rgb_uint8_array) or None on failure.
    """
    try:
        file_size = os.path.getsize(path)
        with Image.open(path) as img:
            if hasattr(img, "n_frames"):
                img.seek(0)
            orig_w, orig_h = img.size  # header-only for most formats

            exif_date = exif_gps = exif_camera = None
            try:
                raw_exif = img._getexif()
                if raw_exif:
                    tags = {ExifTags.TAGS.get(k, k): v for k, v in raw_exif.items()}
                    dt_str = tags.get("DateTimeOriginal") or tags.get("DateTime")
                    if dt_str:
                        from datetime import datetime

                        exif_date = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S").timestamp()
                    make = tags.get("Make", "")
                    model_name = tags.get("Model", "")
                    if make or model_name:
                        exif_camera = f"{make} {model_name}".strip()
                    gps = tags.get("GPSInfo")
                    if gps:
                        exif_gps = json.dumps({"raw": str(gps)})
            except (AttributeError, ValueError, KeyError, TypeError, struct.error):
                pass

            arr = None
            if decode:
                # draft() hints JPEG decoder to produce a reduced-resolution image
                # without decoding the full pixel grid — same principle as ffmpeg low-res decode.
                img.draft("RGB", (load_size, load_size))
                img = img.convert("RGB")
                img.thumbnail((load_size, load_size), Image.LANCZOS)
                arr = np.array(img, dtype=np.uint8)

        return {
            "width": orig_w,
            "height": orig_h,
            "size": file_size,
            "exif_date": exif_date,
            "exif_gps": exif_gps,
            "exif_camera": exif_camera,
            "file_mtime": os.path.getmtime(path),
        }, arr
    except Exception:
        return None


def _phash_from_array(arr: np.ndarray) -> int:
    val = int(str(imagehash.phash(Image.fromarray(arr))), 16)
    return val - 2**64 if val >= 2**63 else val


def generate_thumbnail(src_path: str, out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with Image.open(src_path) as raw:
        if hasattr(raw, "n_frames"):
            raw.seek(0)
        img = raw.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
        img.save(out_path, "JPEG", quality=85)


# Caps concurrent thumbnail generation: a grid page fires one request per card
# and the post-scan warm-up queues a whole library, so without this a cold
# library saturates every core. Same sizing as the video pool in scanner.py.
_THUMBNAIL_GEN_LIMIT = max(1, (os.cpu_count() or 4) // 2)
_thumbnail_gen_semaphore = threading.Semaphore(_THUMBNAIL_GEN_LIMIT)


def get_or_create_image_thumbnail(image_id: int, src_path: str) -> str | None:
    """On-disk thumbnail path for an image, generating it on first request.

    Scanning deliberately skips thumbnails (see scan_image_library) — they're
    made here on first view or by the post-scan `_warm_image_thumbnails` job,
    whichever comes first. Returns None if the source can't be decoded. Written
    to a temp file then renamed, so a concurrent reader never sees a
    half-written JPEG.
    """
    out_path = _thumbnail_path(image_id)
    if os.path.exists(out_path):
        return out_path
    tmp_path = f"{out_path}.{threading.get_ident()}.tmp"
    with _thumbnail_gen_semaphore:
        if os.path.exists(out_path):
            return out_path
        try:
            generate_thumbnail(src_path, tmp_path)
            os.replace(tmp_path, out_path)
        except Exception:
            with contextlib.suppress(FileNotFoundError):
                os.remove(tmp_path)
            return None
    return out_path


def _warm_image_thumbnails(library_id: int) -> None:
    """Background job: generate thumbnails for every image in this library that
    is still missing one, after a scan — the image twin of scanner._warm_thumbnails.

    Tracked as its own Job (JobType.THUMBNAIL_WARM) so it shows on the Jobs page
    with real progress and can be cancelled. No Job row at all when nothing is
    missing.
    """
    db = SessionLocal()
    job_id: int | None = None
    try:
        rows = (
            db.query(ImageFile.id, ImageFile.path)
            .filter(ImageFile.library_id == library_id, ImageFile.status != ImageStatus.FAILED)
            .all()
        )
        missing = [(iid, path) for iid, path in rows if not os.path.exists(_thumbnail_path(iid))]
        if not missing:
            return

        job = Job(
            type=JobType.THUMBNAIL_WARM,
            status=JobStatus.RUNNING,
            library_id=library_id,
            total_files=len(missing),
            started_at=now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
        arm_cancel(job_id)

        completed = 0
        was_cancelled = False
        with _cf.ThreadPoolExecutor(
            max_workers=_THUMBNAIL_GEN_LIMIT, thread_name_prefix="img-thumb-warm"
        ) as pool:
            pending = {pool.submit(get_or_create_image_thumbnail, i, p) for i, p in missing}
            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)
                completed += len(done)
                if should_cancel(job_id):
                    was_cancelled = True
                    for fut in pending:
                        fut.cancel()
                    _cf.wait(pending)
                    pending = set()
                job.processed_files = completed
                if not was_cancelled:
                    job.progress = min(99.0, completed / len(missing) * 100)
                db.commit()

        job.status = JobStatus.CANCELLED if was_cancelled else JobStatus.COMPLETED
        if not was_cancelled:
            job.progress = 100.0
        job.finished_at = now()
        db.commit()
    except Exception as e:
        if job_id is not None:
            fail_job(db, db.get(Job, job_id), e)
    finally:
        if job_id is not None:
            clear_cancel(job_id)
        db.close()


def _enqueue_thumbnail_warm(library_id: int) -> None:
    from app.queue import enqueue_threadsafe

    try:
        enqueue_threadsafe(None, _warm_image_thumbnails, library_id)
    except RuntimeError:  # queue worker not started (tests / one-off scripts)
        pass


def scan_image_library(
    library_id: int,
    job_id: int,
    run_phash: bool = True,
    run_nudenet: bool = True,
    reset: bool = False,
) -> None:
    from app.models.settings import get_setting
    from app.services.image_analyzer import run_nudenet_batch_arrays
    from app.services.model_manager import NUDENET_MODELS

    db = SessionLocal()
    job = None
    stop = threading.Event()  # tells the producer thread to quit, however we exit
    scan_guard = contextlib.ExitStack()
    try:
        library = db.get(ImageLibrary, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        nudenet_model_id = get_setting(db, "nudenet_model", "320n")
        batch_size = int(get_setting(db, "scan_batch_size", "4"))
        prefetch = int(get_setting(db, "scan_prefetch", "4"))

        nudenet_res = NUDENET_MODELS.get(nudenet_model_id, {}).get("inference_resolution", 320)
        extraction_res = max(nudenet_res, 400)
        # Load at max of inference size and thumbnail size so we can serve both from one decode
        load_size = max(extraction_res, THUMBNAIL_SIZE[0])
        # Thumbnails are deferred (see _warm_image_thumbnails), so the pixel decode
        # is only needed when pHash or NudeNet will actually consume it.
        need_pixels = run_phash or run_nudenet

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

        # From here the filesystem watcher leaves this library alone until we
        # finish (it would insert the paths we haven't reached yet). Registered
        # before the existing-paths snapshot below so the two can't interleave.
        scan_guard.enter_context(library_scan_active("image", library_id))

        if reset:
            existing = db.query(ImageFile).filter(ImageFile.library_id == library_id).all()
            for img in existing:
                try:
                    os.remove(_thumbnail_path(img.id))
                except FileNotFoundError:
                    pass
            count = len(existing)
            db.query(ImageFile).filter(ImageFile.library_id == library_id).delete()
            db.commit()
            log(db, job_id, f"Reset: removed {count} existing image records")

        log(db, job_id, f"Scanning image library: {library.path}")

        paths = collect_image_paths(library.path)
        existing_paths = {
            r[0] for r in db.query(ImageFile.path).filter(ImageFile.library_id == library_id).all()
        }
        new_paths = [p for p in paths if p not in existing_paths]
        total = len(new_paths)
        job.total_files = total
        db.commit()

        if total == 0:
            log(db, job_id, "No new images to scan")
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.finished_at = now()
            db.commit()
            _enqueue_thumbnail_warm(library_id)
            return

        log(
            db,
            job_id,
            f"Found {total} new images (load size {load_size}px, "
            f"batch {batch_size}, prefetch {prefetch})",
        )
        arm_cancel(job_id)

        # Queue holds (path, (meta, arr)) or (path, None) per image, then None sentinel.
        work_q: _queue.Queue = _queue.Queue(maxsize=prefetch)

        def _put(item) -> None:
            # Bounded put that gives up once `stop` is set, so an early consumer
            # exit (cancel / failure) can't leave this thread blocked forever.
            while not stop.is_set():
                try:
                    work_q.put(item, timeout=0.5)
                    return
                except _queue.Full:
                    continue

        def producer() -> None:
            try:
                for path in new_paths:
                    if stop.is_set() or should_cancel(job_id):
                        break
                    _put((path, _load_image_for_scan(path, load_size, decode=need_pixels)))
            finally:
                _put(None)  # sentinel, even if loading blew up

        prod = threading.Thread(target=producer, daemon=True, name="image-scan-producer")
        prod.start()

        def _next_item():
            while True:
                try:
                    return work_q.get(timeout=1.0)
                except _queue.Empty:
                    if not prod.is_alive():
                        return None

        succeeded = 0
        failed = 0
        processed = 0
        done = False

        while not done:
            if should_cancel(job_id):
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                return

            # Accumulate up to batch_size images
            batch: list[tuple[str, dict | None, np.ndarray | None]] = []
            while len(batch) < batch_size:
                item = _next_item()
                if item is None:
                    done = True
                    break
                path, result = item
                if result is None:
                    batch.append((path, None, None))
                else:
                    meta, arr = result
                    batch.append((path, meta, arr))

            if not batch:
                break

            job.current_file = os.path.basename(batch[0][0])
            job.progress = processed / total * 100 if total else 100
            db.commit()

            # Rows the filesystem watcher (or anything else) created after our
            # snapshot are filled in rather than re-inserted — path is UNIQUE.
            known_rows = {
                r.path: r
                for r in db.query(ImageFile).filter(ImageFile.path.in_([b[0] for b in batch]))
            }

            # Build ImageFile records; separate good from failed loads
            img_objs: list[ImageFile] = []
            fresh: list[ImageFile] = []
            good_arrays: list[np.ndarray] = []

            for path, meta, arr in batch:
                fname = os.path.basename(path)
                ext = os.path.splitext(path)[1].lower().lstrip(".")
                row = known_rows.get(path)
                if meta is None:
                    if row is None:
                        row = ImageFile(
                            library_id=library_id,
                            path=path,
                            filename=fname,
                            extension=ext,
                            size=0,
                        )
                        db.add(row)
                    row.status = ImageStatus.FAILED
                    row.scan_error = "Failed to load image"
                    failed += 1
                    log(db, job_id, f"Failed: {fname} — could not load", level="error")
                    continue

                if row is None:
                    row = ImageFile(
                        library_id=library_id,
                        path=path,
                        filename=fname,
                        extension=ext,
                        size=meta["size"],
                    )
                    db.add(row)
                    fresh.append(row)
                row.size = meta["size"]
                row.width = meta["width"]
                row.height = meta["height"]
                row.exif_date = meta["exif_date"]
                row.exif_gps = meta["exif_gps"]
                row.exif_camera = meta["exif_camera"]
                row.file_mtime = meta["file_mtime"]
                row.status = ImageStatus.SCANNED
                row.scan_error = None
                row.scanned_at = now()
                if run_phash and arr is not None:
                    row.phash = _phash_from_array(arr)
                img_objs.append(row)
                if arr is not None:
                    good_arrays.append(arr)

            db.flush()  # assign IDs

            # Row ids get reused after deletes; a thumbnail left behind by a
            # previous owner of this id must not be served for the new image.
            for row in fresh:
                with contextlib.suppress(FileNotFoundError):
                    os.remove(_thumbnail_path(row.id))

            # Commit before inference: the flush above holds SQLite's single write
            # lock, and a big NudeNet batch on CPU runs for minutes — every other
            # writer in the app (watcher, other jobs, API) would sit on busy_timeout
            # for the duration. The re-query refreshes the now-expired rows in one
            # SELECT instead of one lazy load per attribute access below.
            img_ids = [o.id for o in img_objs]
            db.commit()
            if img_ids:
                db.query(ImageFile).filter(ImageFile.id.in_(img_ids)).all()

            # NudeNet
            if run_nudenet and good_arrays:
                try:
                    batch_dets = run_nudenet_batch_arrays(good_arrays, model_id=nudenet_model_id)
                    for img_obj, detections in zip(img_objs, batch_dets):
                        img_obj.content_scanned_at = now()
                        for d in detections:
                            db.add(
                                ImageDetection(
                                    image_id=img_obj.id,
                                    label=d["label"],
                                    confidence=d["confidence"],
                                    bbox_json=d["bbox_json"],
                                )
                            )
                except Exception as e:
                    log(db, job_id, f"NudeNet batch failed — {e}", level="error")

            db.commit()
            succeeded += len(img_objs)
            processed += len(batch)
            job.processed_files = processed
            db.commit()

        prod.join(timeout=30)
        library.last_scanned_at = now()
        db.commit()

        clear_cancel(job_id)
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Scan complete — {succeeded} scanned, {failed} failed")
        _enqueue_thumbnail_warm(library_id)

    except Exception as e:
        fail_job(db, job, e)
    finally:
        stop.set()
        scan_guard.close()
        from app.services.image_analyzer import release_sessions

        release_sessions()
        db.close()
