import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.utils import active_job_exists
from app.database import get_db
from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.job import Job, JobStatus, JobType
from app.schemas import AudioLibraryCreate, AudioLibraryRead, AudioLibraryUpdate
from app.services.common import request_cancel

router = APIRouter(prefix="/audio-libraries", tags=["audio-libraries"])


def _with_counts(libs: list[AudioLibrary], db: Session) -> list[AudioLibraryRead]:
    ids = [lib.id for lib in libs]
    if not ids:
        return []
    counts = dict(
        db.query(AudioFile.library_id, func.count(AudioFile.id))
        .filter(AudioFile.library_id.in_(ids))
        .group_by(AudioFile.library_id)
        .all()
    )
    return [
        AudioLibraryRead(
            id=lib.id,
            name=lib.name,
            path=lib.path,
            created_at=lib.created_at,
            last_scanned_at=lib.last_scanned_at,
            file_count=counts.get(lib.id, 0),
        )
        for lib in libs
    ]


def _to_read(lib: AudioLibrary, db: Session) -> AudioLibraryRead:
    return _with_counts([lib], db)[0]


@router.get("", response_model=list[AudioLibraryRead])
def list_audio_libraries(db: Session = Depends(get_db)):
    libs = db.query(AudioLibrary).order_by(AudioLibrary.name).all()
    return _with_counts(libs, db)


@router.post("", response_model=list[AudioLibraryRead], status_code=201)
async def create_audio_library(body: AudioLibraryCreate, db: Session = Depends(get_db)):
    from app.services import fs_watcher

    if body.split_into_sublibraries:
        try:
            subdirs = sorted(
                e.path
                for e in os.scandir(body.path)
                if e.is_dir(follow_symlinks=True) and not e.name.startswith(".")
            )
        except (PermissionError, FileNotFoundError, NotADirectoryError) as exc:
            raise HTTPException(400, f"Cannot read directory: {exc}")
        if not subdirs:
            raise HTTPException(422, "No subdirectories found at the selected path")

        created: list[AudioLibrary] = []
        for subdir in subdirs:
            if db.query(AudioLibrary).filter(AudioLibrary.path == subdir).first():
                continue
            lib = AudioLibrary(name=os.path.basename(subdir), path=subdir)
            db.add(lib)
            db.commit()
            db.refresh(lib)
            fs_watcher.watch_library(lib.id, lib.path, kind="audio")
            created.append(lib)
        if not created:
            raise HTTPException(409, "All sublibraries already exist")
        return _with_counts(created, db)

    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path does not exist or is not a directory")
    existing = db.query(AudioLibrary).filter(AudioLibrary.path == body.path).first()
    if existing:
        raise HTTPException(409, "A library with this path already exists")
    name = body.name or os.path.basename(body.path.rstrip("/"))
    lib = AudioLibrary(name=name, path=body.path)
    db.add(lib)
    db.commit()
    db.refresh(lib)
    fs_watcher.watch_library(lib.id, lib.path, kind="audio")
    return _with_counts([lib], db)


@router.patch("/{library_id}", response_model=AudioLibraryRead)
def update_audio_library(library_id: int, body: AudioLibraryUpdate, db: Session = Depends(get_db)):
    lib = db.get(AudioLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if body.name is not None:
        lib.name = body.name
    if body.scan_automatically is not None:
        lib.scan_automatically = body.scan_automatically
    db.commit()
    db.refresh(lib)
    return _to_read(lib, db)


@router.get("/{library_id}/leftovers")
def audio_library_leftovers(library_id: int, db: Session = Depends(get_db)):
    """Check for _originals/ directories inside the library path."""
    lib = db.get(AudioLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    count = 0
    total_bytes = 0
    for dirpath, dirnames, filenames in os.walk(lib.path):
        if os.path.basename(dirpath) == "_originals":
            for fname in filenames:
                try:
                    total_bytes += os.path.getsize(os.path.join(dirpath, fname))
                    count += 1
                except OSError:
                    pass
            dirnames.clear()
    return {
        "has_leftovers": count > 0,
        "dir_name": "_originals",
        "count": count,
        "total_bytes": total_bytes,
    }


@router.delete("/{library_id}", status_code=204)
def delete_audio_library(
    library_id: int, delete_leftovers: bool = False, db: Session = Depends(get_db)
):
    lib = db.get(AudioLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    # Stop watcher first so no new audio records are inserted while we clean up
    from app.services import fs_watcher

    fs_watcher.unwatch_library(library_id, kind="audio")

    _audio_job_types = (JobType.AUDIO_SCAN, JobType.AUDIO_COMPRESS)
    active_jobs = (
        db.query(Job)
        .filter(
            Job.library_id == library_id,
            Job.type.in_(_audio_job_types),
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .all()
    )
    for job in active_jobs:
        request_cancel(job.id)

    # Null out library_id on audio job records (FK prevents library delete
    # otherwise). Scoped to audio job types — library ids collide across
    # video/image/audio and Job has no kind column.
    db.query(Job).filter(Job.library_id == library_id, Job.type.in_(_audio_job_types)).update(
        {Job.library_id: None}, synchronize_session=False
    )
    db.query(AudioFile).filter(AudioFile.library_id == library_id).delete()
    lib_path = lib.path
    db.delete(lib)
    db.commit()

    # Belt-and-suspenders: remove any AudioFile records still referencing this
    # library_id (background jobs may have inserted after we started deleting).
    lingering = (
        db.query(AudioFile.id).filter(AudioFile.library_id == library_id).first() is not None
    )
    if lingering:
        db.query(AudioFile).filter(AudioFile.library_id == library_id).delete()
        db.commit()

    if delete_leftovers:
        import shutil

        for dirpath, dirnames, _ in os.walk(lib_path):
            if os.path.basename(dirpath) == "_originals":
                shutil.rmtree(dirpath, ignore_errors=True)
                dirnames.clear()


@router.post("/{library_id}/scan", status_code=202)
async def scan_audio_library_endpoint(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(AudioLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    if active_job_exists(db, library_id, JobType.AUDIO_SCAN):
        raise HTTPException(409, "A scan is already running for this library")

    job = Job(type=JobType.AUDIO_SCAN, status=JobStatus.PENDING, library_id=library_id)
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.queue import enqueue
    from app.services.audio_scanner import scan_audio_library

    await enqueue(job.id, scan_audio_library, library_id, job.id)
    return {"job_id": job.id}


@router.post("/{library_id}/find-duplicates", status_code=202)
async def find_audio_duplicates_endpoint(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(AudioLibrary, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    file_count = (
        db.query(func.count(AudioFile.id)).filter(AudioFile.library_id == library_id).scalar()
    )
    if file_count == 0:
        raise HTTPException(
            422, "Scan the library first to index files before checking for duplicates"
        )

    job = Job(type=JobType.AUDIO_DUPLICATES, status=JobStatus.PENDING, library_id=library_id)
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.queue import enqueue
    from app.services.audio_duplicates import extract_audio_fingerprints

    await enqueue(job.id, extract_audio_fingerprints, library_id, job.id)
    return {"job_id": job.id, "message": "Audio fingerprint extraction queued"}
