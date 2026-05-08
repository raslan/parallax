import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.library import Library
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.schemas import LibraryCreate, LibraryRead, LibraryUpdate, StatsRead, BrowseResponse, FileRead
from app.services.scanner import scan_library, thumbnail_path
from app.services.corruption import check_library_corruption
from app.queue import enqueue

router = APIRouter(prefix="/libraries", tags=["libraries"])


def _active_job_exists(db: Session, library_id: int, job_type: str) -> bool:
    return db.query(Job).filter(
        Job.library_id == library_id,
        Job.type == job_type,
        Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING]),
    ).first() is not None


def _with_counts(libs: list[Library], db: Session) -> list[LibraryRead]:
    ids = [l.id for l in libs]
    if not ids:
        return []
    counts = dict(
        db.query(File.library_id, func.count(File.id))
        .filter(File.library_id.in_(ids))
        .group_by(File.library_id).all()
    )
    corrupt = dict(
        db.query(File.library_id, func.count(File.id))
        .filter(File.library_id.in_(ids), File.status == FileStatus.CORRUPT)
        .group_by(File.library_id).all()
    )
    out = []
    for lib in libs:
        lr = LibraryRead.model_validate(lib)
        lr.file_count = counts.get(lib.id, 0)
        lr.corrupt_count = corrupt.get(lib.id, 0)
        out.append(lr)
    return out


@router.get("", response_model=list[LibraryRead])
def list_libraries(db: Session = Depends(get_db)):
    libs = db.query(Library).order_by(Library.created_at).all()
    return _with_counts(libs, db)


@router.post("", response_model=LibraryRead, status_code=201)
def create_library(body: LibraryCreate, db: Session = Depends(get_db)):
    existing = db.query(Library).filter(Library.path == body.path).first()
    if existing:
        raise HTTPException(400, "A library with this path already exists")
    lib = Library(**body.model_dump())
    db.add(lib)
    db.commit()
    db.refresh(lib)
    return lib


@router.get("/stats", response_model=StatsRead)
def get_stats(db: Session = Depends(get_db)):
    from app.models.job import Job, JobStatus, JobType
    from app.models.file import FileStatus

    total_libraries = db.query(func.count(Library.id)).scalar()
    total_files = db.query(func.count(File.id)).scalar()
    corrupt_files = db.query(func.count(File.id)).filter(File.status == FileStatus.CORRUPT).scalar()
    transcoded_files = db.query(func.count(File.id)).filter(File.status == FileStatus.DONE).scalar()
    total_size = db.query(func.coalesce(func.sum(File.size), 0)).scalar()
    scanning = db.query(Job).filter(
        Job.type == JobType.SCAN,
        Job.status == JobStatus.RUNNING,
    ).first() is not None

    return StatsRead(
        total_libraries=total_libraries,
        total_files=total_files,
        corrupt_files=corrupt_files,
        transcoded_files=transcoded_files,
        total_size_bytes=total_size,
        scanning=scanning,
    )


@router.get("/{library_id}", response_model=LibraryRead)
def get_library(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    return lib


@router.patch("/{library_id}", response_model=LibraryRead)
def update_library(library_id: int, body: LibraryUpdate, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(lib, field, value)
    db.commit()
    db.refresh(lib)
    return lib


@router.delete("/{library_id}", status_code=204)
def delete_library(library_id: int, db: Session = Depends(get_db)):
    from app.services.common import request_cancel
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    # Signal any running jobs for this library to stop before we pull the rug
    active_jobs = db.query(Job).filter(
        Job.library_id == library_id,
        Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING]),
    ).all()
    for job in active_jobs:
        request_cancel(job.id)
    db.query(File).filter(File.library_id == library_id).delete()
    db.delete(lib)
    db.commit()


@router.post("/{library_id}/scan", status_code=202)
async def trigger_scan(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if _active_job_exists(db, library_id, JobType.SCAN):
        raise HTTPException(409, "A scan is already running for this library")
    await enqueue(scan_library, library_id)
    return {"message": "Scan queued"}


@router.post("/{library_id}/check", status_code=202)
async def trigger_check(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if _active_job_exists(db, library_id, JobType.CHECK):
        raise HTTPException(409, "A corruption check is already running for this library")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index its files before checking for corruption")
    await enqueue(check_library_corruption, library_id)
    return {"message": "Corruption check queued"}


@router.get("/{library_id}/browse", response_model=BrowseResponse)
def browse_library(
    library_id: int,
    path: str = Query("", description="Subdirectory path relative to the library root"),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    base = lib.path.rstrip("/")
    current = f"{base}/{path}".rstrip("/") if path else base
    prefix = current + "/"

    q = db.query(File).filter(File.library_id == library_id, File.path.like(f"{prefix}%"))
    if status:
        q = q.filter(File.status == status)
    all_files = q.all()

    dirs: set[str] = set()
    direct_files: list[File] = []

    for f in all_files:
        rel = f.path[len(prefix):]  # relative to current dir, no leading slash
        slash = rel.find("/")
        if slash == -1:
            direct_files.append(f)
        else:
            dirs.add(rel[:slash])

    def to_read(f: File) -> FileRead:
        return FileRead(
            id=f.id, library_id=f.library_id, path=f.path, filename=f.filename,
            size=f.size, duration=f.duration, status=f.status, scan_error=f.scan_error,
            scanned_at=f.scanned_at, transcoded_at=f.transcoded_at, created_at=f.created_at,
            has_thumbnail=os.path.exists(thumbnail_path(f.id)),
        )

    return BrowseResponse(
        path=path,
        dirs=sorted(dirs),
        files=[to_read(f) for f in sorted(direct_files, key=lambda f: f.filename)],
    )
