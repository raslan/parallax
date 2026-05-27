import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.image_library import ImageLibrary
from app.models.image import ImageFile
from app.models.job import Job, JobStatus, JobType
from app.schemas import ImageLibraryCreate, ImageLibraryRead, ImageScanRequest
from app.services.common import now

router = APIRouter(prefix="/image-libraries", tags=["image-libraries"])


def _to_read(lib: ImageLibrary, db: Session) -> ImageLibraryRead:
    count = db.query(func.count(ImageFile.id)).filter(
        ImageFile.library_id == lib.id
    ).scalar()
    return ImageLibraryRead(
        id=lib.id,
        name=lib.name,
        path=lib.path,
        created_at=lib.created_at,
        last_scanned_at=lib.last_scanned_at,
        image_count=count or 0,
    )


@router.get("", response_model=list[ImageLibraryRead])
def list_image_libraries(db: Session = Depends(get_db)):
    libs = db.query(ImageLibrary).order_by(ImageLibrary.name).all()
    return [_to_read(lib, db) for lib in libs]


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
    return _to_read(lib, db)


@router.delete("/{library_id}", status_code=204)
def delete_image_library(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(ImageLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    db.delete(lib)
    db.commit()


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
        Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if running:
        raise HTTPException(409, "An image scan is already running")

    job = Job(
        type=JobType.IMAGE_SCAN,
        status=JobStatus.PENDING,
        library_id=library_id,
        settings=f"phash={body.run_phash},nudenet={body.run_nudenet},siglip={body.run_siglip}",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.image_scanner import scan_image_library as do_scan
    from app.queue import enqueue
    await enqueue(
        job.id, do_scan, library_id, job.id,
        body.run_phash, body.run_nudenet, body.run_siglip,
    )
    return {"job_id": job.id}
