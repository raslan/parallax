import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db, DATA_DIR
from app.models.image_library import ImageLibrary
from app.models.image import ImageFile, ImageDetection
from app.models.job import Job, JobStatus, JobType
from app.schemas import ImageLibraryCreate, ImageLibraryRead, ImageScanRequest
from app.services.common import now, request_cancel

router = APIRouter(prefix="/image-libraries", tags=["image-libraries"])


def _with_counts(libs: list[ImageLibrary], db: Session) -> list[ImageLibraryRead]:
    ids = [l.id for l in libs]
    if not ids:
        return []
    counts = dict(
        db.query(ImageFile.library_id, func.count(ImageFile.id))
        .filter(ImageFile.library_id.in_(ids))
        .group_by(ImageFile.library_id).all()
    )
    return [
        ImageLibraryRead(
            id=lib.id,
            name=lib.name,
            path=lib.path,
            created_at=lib.created_at,
            last_scanned_at=lib.last_scanned_at,
            image_count=counts.get(lib.id, 0),
        )
        for lib in libs
    ]


def _to_read(lib: ImageLibrary, db: Session) -> ImageLibraryRead:
    return _with_counts([lib], db)[0]


@router.get("", response_model=list[ImageLibraryRead])
def list_image_libraries(db: Session = Depends(get_db)):
    libs = db.query(ImageLibrary).order_by(ImageLibrary.name).all()
    return _with_counts(libs, db)


@router.post("", response_model=ImageLibraryRead, status_code=201)
def create_image_library(body: ImageLibraryCreate, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path does not exist or is not a directory")
    existing = db.query(ImageLibrary).filter(ImageLibrary.path == body.path).first()
    if existing:
        raise HTTPException(409, "A library with this path already exists")
    name = body.name or os.path.basename(body.path.rstrip("/"))
    lib = ImageLibrary(name=name, path=body.path)
    db.add(lib)
    db.commit()
    db.refresh(lib)
    from app.services import fs_watcher
    fs_watcher.watch_library(lib.id, lib.path, is_image=True)
    return _to_read(lib, db)


@router.get("/{library_id}/leftovers")
def image_library_leftovers(library_id: int, db: Session = Depends(get_db)):
    """Check for _quarantine/ directories inside the library path."""
    lib = db.get(ImageLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    count = 0
    total_bytes = 0
    for dirpath, dirnames, filenames in os.walk(lib.path):
        if os.path.basename(dirpath) == "_quarantine":
            for fname in filenames:
                try:
                    total_bytes += os.path.getsize(os.path.join(dirpath, fname))
                    count += 1
                except OSError:
                    pass
            dirnames.clear()
    return {"has_leftovers": count > 0, "dir_name": "_quarantine", "count": count, "total_bytes": total_bytes}


@router.delete("/{library_id}", status_code=204)
def delete_image_library(library_id: int, delete_leftovers: bool = False, db: Session = Depends(get_db)):
    lib = db.get(ImageLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    # Stop watcher first so no new image records are inserted while we clean up
    from app.services import fs_watcher
    fs_watcher.unwatch_library(library_id)

    active_jobs = db.query(Job).filter(
        Job.type == JobType.IMAGE_SCAN,
        Job.library_id == library_id,
        Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).all()
    for job in active_jobs:
        request_cancel(job.id)

    image_ids = [
        row[0] for row in
        db.query(ImageFile.id).filter(ImageFile.library_id == library_id).all()
    ]
    if image_ids:
        db.query(ImageDetection).filter(
            ImageDetection.image_id.in_(image_ids)
        ).delete(synchronize_session=False)
    db.query(ImageFile).filter(ImageFile.library_id == library_id).delete()
    lib_path = lib.path
    db.delete(lib)
    db.commit()
    if delete_leftovers:
        import shutil
        for dirpath, dirnames, _ in os.walk(lib_path):
            if os.path.basename(dirpath) == "_quarantine":
                shutil.rmtree(dirpath, ignore_errors=True)
                dirnames.clear()

    thumb_dir = os.path.join(DATA_DIR, "image-thumbnails")
    for image_id in image_ids:
        try:
            os.remove(os.path.join(thumb_dir, f"{image_id}.jpg"))
        except FileNotFoundError:
            pass


@router.post("/{library_id}/scan", status_code=202)
async def scan_image_library(
    library_id: int,
    body: ImageScanRequest,
    db: Session = Depends(get_db),
):
    lib = db.get(ImageLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    running = db.query(Job).filter(
        Job.type == JobType.IMAGE_SCAN,
        Job.library_id == library_id,
        Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if running:
        raise HTTPException(409, "A scan is already running for this library")

    job = Job(
        type=JobType.IMAGE_SCAN,
        status=JobStatus.PENDING,
        library_id=library_id,
        settings=f"phash={body.run_phash},nudenet={body.run_nudenet},clip={body.run_clip},reset={body.reset}",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.image_scanner import scan_image_library as do_scan
    from app.queue import enqueue
    await enqueue(
        job.id, do_scan, library_id, job.id,
        body.run_phash, body.run_nudenet, body.run_clip, body.reset,
    )
    return {"job_id": job.id}
