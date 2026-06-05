import json
import os
import queue as _queue
import struct
import threading
import numpy as np
import imagehash
from PIL import Image, ExifTags

from app.database import SessionLocal, DATA_DIR
from app.models.image_library import ImageLibrary
from app.models.image import ImageFile, ImageDetection, ImageStatus
from app.models.job import Job, JobStatus
from app.services.common import arm_cancel, should_cancel, clear_cancel, now, log

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
) -> tuple[dict, np.ndarray] | None:
    """
    Open image once: extract metadata from header, decode at reduced resolution.
    Uses PIL draft() for JPEG (DCT-domain downsampling — no full-res decode).
    Returns (meta_dict, rgb_uint8_array) or None on failure.
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
                    make       = tags.get("Make", "")
                    model_name = tags.get("Model", "")
                    if make or model_name:
                        exif_camera = f"{make} {model_name}".strip()
                    gps = tags.get("GPSInfo")
                    if gps:
                        exif_gps = json.dumps({"raw": str(gps)})
            except (AttributeError, ValueError, KeyError, TypeError, struct.error):
                pass

            # draft() hints JPEG decoder to produce a reduced-resolution image
            # without decoding the full pixel grid — same principle as ffmpeg low-res decode.
            img.draft("RGB", (load_size, load_size))
            img = img.convert("RGB")
            img.thumbnail((load_size, load_size), Image.LANCZOS)
            arr = np.array(img, dtype=np.uint8)

        return {
            "width":       orig_w,
            "height":      orig_h,
            "size":        file_size,
            "exif_date":   exif_date,
            "exif_gps":    exif_gps,
            "exif_camera": exif_camera,
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


def _generate_thumbnail_from_array(arr: np.ndarray, out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img = Image.fromarray(arr)
    img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
    img.save(out_path, "JPEG", quality=85)


def scan_image_library(
    library_id: int,
    job_id: int,
    run_phash: bool = True,
    run_nudenet: bool = True,
    run_clip: bool = True,
    reset: bool = False,
) -> None:
    from app.models.settings import get_setting
    from app.services.model_manager import CLIP_MODELS, NUDENET_MODELS
    from app.services.image_analyzer import encode_image_clip_batch_arrays, run_nudenet_batch_arrays

    db = SessionLocal()
    job = None
    try:
        library = db.get(ImageLibrary, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        clip_model_id    = get_setting(db, "clip_model",      "clip-vit-base-patch32")
        nudenet_model_id = get_setting(db, "nudenet_model",   "320n")
        batch_size       = int(get_setting(db, "scan_batch_size", "4"))
        prefetch         = int(get_setting(db, "scan_prefetch",   "4"))

        clip_res    = CLIP_MODELS.get(clip_model_id,    {}).get("image_size",           224)
        nudenet_res = NUDENET_MODELS.get(nudenet_model_id, {}).get("inference_resolution", 320) if run_nudenet else 0
        extraction_res = max(clip_res, nudenet_res)
        # Load at max of inference size and thumbnail size so we can serve both from one decode
        load_size = max(extraction_res, THUMBNAIL_SIZE[0])

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()

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
            r[0] for r in
            db.query(ImageFile.path).filter(ImageFile.library_id == library_id).all()
        }
        new_paths = [p for p in paths if p not in existing_paths]
        total = len(new_paths)
        job.total_files = total
        db.commit()

        if total == 0:
            log(db, job_id, "No new images to scan")
            job.status      = JobStatus.COMPLETED
            job.progress    = 100.0
            job.finished_at = now()
            db.commit()
            return

        log(db, job_id,
            f"Found {total} new images (load size {load_size}px, "
            f"batch {batch_size}, prefetch {prefetch})")
        arm_cancel(job_id)

        # Queue holds (path, (meta, arr)) or (path, None) per image, then None sentinel.
        work_q: _queue.Queue = _queue.Queue(maxsize=prefetch)

        def producer() -> None:
            for path in new_paths:
                if should_cancel(job_id):
                    break
                work_q.put((path, _load_image_for_scan(path, load_size)))
            work_q.put(None)

        prod = threading.Thread(target=producer, daemon=True)
        prod.start()

        succeeded  = 0
        failed     = 0
        processed  = 0
        done       = False

        while not done:
            if should_cancel(job_id):
                job.status      = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                prod.join(timeout=30)
                return

            # Accumulate up to batch_size images
            batch: list[tuple[str, dict | None, np.ndarray | None]] = []
            while len(batch) < batch_size:
                item = work_q.get()
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
            job.progress     = processed / total * 100 if total else 100
            db.commit()

            # Build ImageFile records; separate good from failed loads
            img_objs:    list[ImageFile]    = []
            good_arrays: list[np.ndarray]   = []

            for path, meta, arr in batch:
                fname = os.path.basename(path)
                ext   = os.path.splitext(path)[1].lower().lstrip(".")
                if meta is None:
                    db.add(ImageFile(
                        library_id=library_id,
                        path=path,
                        filename=fname,
                        extension=ext,
                        size=0,
                        status=ImageStatus.FAILED,
                        scan_error="Failed to load image",
                    ))
                    failed += 1
                    log(db, job_id, f"Failed: {fname} — could not load", level="error")
                    continue

                img_obj = ImageFile(
                    library_id=library_id,
                    path=path,
                    filename=fname,
                    extension=ext,
                    size=meta["size"],
                    width=meta["width"],
                    height=meta["height"],
                    exif_date=meta["exif_date"],
                    exif_gps=meta["exif_gps"],
                    exif_camera=meta["exif_camera"],
                    status=ImageStatus.SCANNED,
                    scanned_at=now(),
                )
                if run_phash:
                    img_obj.phash = _phash_from_array(arr)
                db.add(img_obj)
                img_objs.append(img_obj)
                good_arrays.append(arr)

            db.flush()  # assign IDs

            # Thumbnails — generated from the already-loaded array, no extra disk read
            for img_obj, arr in zip(img_objs, good_arrays):
                try:
                    _generate_thumbnail_from_array(arr, _thumbnail_path(img_obj.id))
                except Exception:
                    pass

            # CLIP
            if run_clip and good_arrays:
                try:
                    embeddings = encode_image_clip_batch_arrays(good_arrays, model_id=clip_model_id)
                    for img_obj, emb in zip(img_objs, embeddings):
                        img_obj.clip_embedding = json.dumps(emb)
                except Exception as e:
                    log(db, job_id, f"CLIP batch failed — {e}", level="error")

            # NudeNet
            if run_nudenet and good_arrays:
                try:
                    batch_dets = run_nudenet_batch_arrays(good_arrays, model_id=nudenet_model_id)
                    for img_obj, detections in zip(img_objs, batch_dets):
                        for d in detections:
                            db.add(ImageDetection(
                                image_id=img_obj.id,
                                label=d["label"],
                                confidence=d["confidence"],
                                bbox_json=d["bbox_json"],
                            ))
                except Exception as e:
                    log(db, job_id, f"NudeNet batch failed — {e}", level="error")

            db.commit()
            succeeded  += len(img_objs)
            processed  += len(batch)
            job.processed_files = processed
            db.commit()

        prod.join(timeout=30)
        library.last_scanned_at = now()
        db.commit()

        clear_cancel(job_id)
        job.status      = JobStatus.COMPLETED
        job.progress    = 100.0
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Scan complete — {succeeded} scanned, {failed} failed")

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
