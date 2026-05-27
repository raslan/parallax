import os
import json
from PIL import Image
from app.database import SessionLocal, DATA_DIR
from app.models.image_library import ImageLibrary
from app.models.image import ImageFile, ImageDetection, ImageStatus
from app.models.job import Job, JobStatus, JobType
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


def generate_thumbnail(src_path: str, out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with Image.open(src_path) as raw:
        img = raw.convert("RGB")
        if hasattr(raw, "n_frames"):
            raw.seek(0)
            img = raw.convert("RGB")
        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
        img.save(out_path, "JPEG", quality=85)


def _thumbnail_path(image_id: int) -> str:
    return os.path.join(THUMBNAIL_DIR, f"{image_id}.jpg")


def _process_one(db, library_id: int, path: str,
                  run_phash: bool, run_nudenet: bool, run_siglip: bool) -> ImageFile:
    from app.services.image_analyzer import (
        get_image_metadata, compute_phash, run_nudenet as nudenet_detect,
        encode_image_siglip,
    )
    meta = get_image_metadata(path)
    ext = os.path.splitext(path)[1].lower().lstrip(".")

    img_obj = ImageFile(
        library_id=library_id,
        path=path,
        filename=os.path.basename(path),
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
        img_obj.phash = compute_phash(path)

    if run_siglip:
        embedding = encode_image_siglip(path)
        img_obj.siglip_embedding = json.dumps(embedding)

    db.add(img_obj)
    db.flush()  # get img_obj.id

    if run_nudenet:
        detections = nudenet_detect(path)
        for d in detections:
            db.add(ImageDetection(
                image_id=img_obj.id,
                label=d["label"],
                confidence=d["confidence"],
                bbox_json=d["bbox_json"],
            ))

    generate_thumbnail(path, _thumbnail_path(img_obj.id))
    return img_obj


def scan_image_library(library_id: int, job_id: int,
                        run_phash: bool = True,
                        run_nudenet: bool = True,
                        run_siglip: bool = True) -> None:
    db = SessionLocal()
    job = None
    try:
        library = db.get(ImageLibrary, library_id)
        if not library:
            return

        job = db.get(Job, job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        db.commit()
        log(db, job_id, f"Scanning image library: {library.path}")

        paths = collect_image_paths(library.path)
        existing_paths = {r[0] for r in db.query(ImageFile.path)
                          .filter(ImageFile.library_id == library_id).all()}

        new_paths = [p for p in paths if p not in existing_paths]
        total = len(new_paths)
        job.total_files = total
        db.commit()

        arm_cancel(job_id)
        succeeded = failed = 0

        for i, path in enumerate(new_paths):
            if should_cancel(job_id):
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                clear_cancel(job_id)
                return

            job.current_file = os.path.basename(path)
            job.progress = i / total * 100 if total else 100
            db.commit()

            try:
                _process_one(db, library_id, path, run_phash, run_nudenet, run_siglip)
                db.commit()
                succeeded += 1
            except Exception as e:
                db.rollback()
                err = ImageFile(
                    library_id=library_id,
                    path=path,
                    filename=os.path.basename(path),
                    extension=os.path.splitext(path)[1].lower().lstrip("."),
                    size=0,
                    status=ImageStatus.FAILED,
                    scan_error=str(e)[:512],
                )
                db.add(err)
                db.commit()
                failed += 1
                log(db, job_id, f"Failed: {os.path.basename(path)} — {e}", level="error")

            job.processed_files = i + 1
            db.commit()

        library.last_scanned_at = now()
        db.commit()

        clear_cancel(job_id)
        job.status = JobStatus.COMPLETED
        job.finished_at = now()
        job.progress = 100.0
        db.commit()
        log(db, job_id, f"Scan complete — {succeeded} scanned, {failed} failed")

    except Exception as e:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
