import os
import shutil
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.services.video_scanner import delete_keyframes
from app.models.library import Library
from app.models.file import File, FileStatus
from app.models.video import VideoDetection
from app.models.job import Job, JobStatus, JobType
from app.schemas import (
    LibraryCreate, LibraryRead, LibraryUpdate, StatsRead,
    BrowseResponse, FileRead, TranscodeRequest, DuplicateCriteriaRequest,
    DuplicateGroupRead, DuplicateFileRead, DeleteDuplicatesRequest,
)
from app.services.scanner import scan_library, thumbnail_path
from app.services.corruption import check_library_corruption
from app.services.transcoder import transcode_library_corrupt
from app.queue import enqueue
from app.api.utils import active_job_exists

router = APIRouter(prefix="/libraries", tags=["libraries"])


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


@router.post("", response_model=list[LibraryRead], status_code=201)
def create_library(body: LibraryCreate, db: Session = Depends(get_db)):
    if body.split_into_sublibraries:
        try:
            subdirs = sorted(
                e.path for e in os.scandir(body.path)
                if e.is_dir(follow_symlinks=True) and not e.name.startswith(".")
            )
        except (PermissionError, FileNotFoundError, NotADirectoryError) as exc:
            raise HTTPException(400, f"Cannot read directory: {exc}")
        if not subdirs:
            raise HTTPException(422, "No subdirectories found at the selected path")
        from app.services import fs_watcher
        created = []
        for subdir in subdirs:
            if db.query(Library).filter(Library.path == subdir).first():
                continue
            lib = Library(name=os.path.basename(subdir), path=subdir)
            db.add(lib)
            db.commit()
            db.refresh(lib)
            created.append(lib)
            fs_watcher.watch_library(lib.id, lib.path, is_image=False)
        return _with_counts(created, db)
    else:
        if db.query(Library).filter(Library.path == body.path).first():
            raise HTTPException(400, "A library with this path already exists")
        lib = Library(name=body.name, path=body.path)
        db.add(lib)
        db.commit()
        db.refresh(lib)
        from app.services import fs_watcher
        fs_watcher.watch_library(lib.id, lib.path, is_image=False)
        return [lib]


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
    files = db.query(File).filter(File.library_id == library_id).all()
    for f in files:
        delete_keyframes(f.id)
    db.query(File).filter(File.library_id == library_id).delete()
    db.delete(lib)
    db.commit()
    from app.services import fs_watcher
    fs_watcher.unwatch_library(library_id)


@router.post("/{library_id}/scan", status_code=202)
async def trigger_scan(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if active_job_exists(db, library_id, JobType.SCAN):
        raise HTTPException(409, "A scan is already running for this library")
    await enqueue(None, scan_library, library_id)
    return {"message": "Scan queued"}


@router.post("/{library_id}/check", status_code=202)
async def trigger_check(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if active_job_exists(db, library_id, JobType.CHECK):
        raise HTTPException(409, "A corruption check is already running for this library")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index its files before checking for corruption")
    await enqueue(None, check_library_corruption, library_id)
    return {"message": "Corruption check queued"}



@router.post("/{library_id}/transcode", status_code=202)
async def trigger_transcode(library_id: int, body: TranscodeRequest, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if active_job_exists(db, library_id, JobType.TRANSCODE):
        raise HTTPException(409, "A transcode job is already running for this library")
    corrupt_count = db.query(func.count(File.id)).filter(
        File.library_id == library_id, File.status == FileStatus.CORRUPT
    ).scalar()
    if corrupt_count == 0:
        raise HTTPException(422, "No corrupt files to transcode in this library")
    job = Job(type=JobType.TRANSCODE, status=JobStatus.PENDING, library_id=library_id, settings=body.preset)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, transcode_library_corrupt, library_id, body.preset, job.id)
    return {"message": "Transcode queued"}


_BROWSE_SORT_KEYS = {
    "filename":      lambda f: (f.filename or "").lower(),
    "extension":     lambda f: (f.extension or "").lower(),
    "size":          lambda f: f.size or 0,
    "duration":      lambda f: f.duration or 0,
    "video_bitrate": lambda f: f.video_bitrate or 0,
    "created_at":    lambda f: f.created_at or "",
}


@router.get("/{library_id}/browse", response_model=BrowseResponse)
def browse_library(
    library_id: int,
    path: str = Query("", description="Subdirectory path relative to the library root"),
    status: str | None = Query(None),
    sort_by: str = Query("filename"),
    sort_dir: str = Query("asc"),
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
            size=f.size, duration=f.duration, codec_name=f.codec_name,
            video_bitrate=f.video_bitrate, status=f.status, scan_error=f.scan_error,
            scanned_at=f.scanned_at, transcoded_at=f.transcoded_at, created_at=f.created_at,
            has_thumbnail=os.path.exists(thumbnail_path(f.id)),
            file_width=f.file_width,
            file_height=f.file_height,
            file_fps=f.file_fps,
            file_date=f.file_date,
        )

    sort_key = _BROWSE_SORT_KEYS.get(sort_by, _BROWSE_SORT_KEYS["filename"])
    sorted_files = sorted(direct_files, key=sort_key, reverse=(sort_dir == "desc"))

    return BrowseResponse(
        path=path,
        dirs=sorted(dirs),
        files=[to_read(f) for f in sorted_files],
    )


@router.post("/{library_id}/video-scan", status_code=202)
async def trigger_video_scan(
    library_id: int,
    reset: bool = False,
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index its files before running AI scan")
    if active_job_exists(db, library_id, JobType.VIDEO_SCAN):
        raise HTTPException(409, "A video scan is already running for this library")
    from app.services.video_scanner import scan_video_library
    job = Job(type=JobType.VIDEO_SCAN, status=JobStatus.PENDING, library_id=library_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, scan_video_library, library_id, job.id, True, True, reset)
    return {"job_id": job.id, "message": "Video AI scan queued"}


@router.post("/{library_id}/find-duplicates", status_code=202)
async def find_duplicates_endpoint(
    library_id: int,
    body: DuplicateCriteriaRequest = Body(default=DuplicateCriteriaRequest()),
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    if not body.use_size and not body.use_duration and not body.use_phash:
        raise HTTPException(422, "At least one matching criterion must be selected")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index files before checking for duplicates")
    if active_job_exists(db, library_id, JobType.DUPLICATES):
        raise HTTPException(409, "A duplicate scan is already running for this library")
    from app.services.duplicates import find_duplicates
    job = Job(type=JobType.DUPLICATES, status=JobStatus.PENDING, library_id=library_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, find_duplicates, library_id, job.id, body.use_size, body.use_duration, body.use_phash, body.duration_tolerance, body.phash_threshold, body.phash_mode)
    return {"message": "Duplicate scan queued"}


@router.get("/{library_id}/duplicates", response_model=list[DuplicateGroupRead])
def get_duplicates_endpoint(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    from app.services.duplicates import get_cached_results
    from app.services.scanner import thumbnail_path
    results = get_cached_results(library_id)
    import logging as _logging
    _logging.getLogger(__name__).warning("get_duplicates_endpoint: library=%d results=%s", library_id, None if results is None else f"{len(results)} groups")
    if results is None:
        raise HTTPException(404, "No duplicate scan has been run for this library yet")
    out = []
    for group in results:
        files = [
            DuplicateFileRead(
                id=f.id,
                library_id=f.library_id,
                path=f.path,
                filename=f.filename,
                size=f.size,
                duration=f.duration,
                codec_name=f.codec_name,
                video_bitrate=f.video_bitrate,
                status=f.status,
                has_thumbnail=os.path.exists(thumbnail_path(f.id)),
            )
            for f in group.files
        ]
        out.append(DuplicateGroupRead(files=files, keep_id=group.keep_id))
    return out


@router.delete("/{library_id}/duplicates", status_code=204)
def delete_duplicates_endpoint(
    library_id: int,
    body: DeleteDuplicatesRequest,
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    for file_id in body.file_ids:
        f = db.get(File, file_id)
        if not f or f.library_id != library_id:
            continue
        if os.path.exists(f.path):
            originals_dir = os.path.join(os.path.dirname(f.path), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            shutil.move(f.path, os.path.join(originals_dir, f.filename))
        delete_keyframes(f.id)
        db.query(VideoDetection).filter(VideoDetection.file_id == f.id).delete()
        db.delete(f)
    db.commit()


@router.get("/{library_id}/cleanup", response_model=list[FileRead])
def get_cleanup_files(
    library_id: int,
    duration_op: str | None = Query(None),
    duration_secs: float | None = Query(None),
    fps_op: str | None = Query(None),
    fps_val: float | None = Query(None),
    date_op: str | None = Query(None),
    date_ts: float | None = Query(None),
    height_op: str | None = Query(None),
    height_val: int | None = Query(None),
    fetch_all: bool = Query(False),
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    filters_present = any([
        duration_op and duration_secs is not None,
        fps_op and fps_val is not None,
        date_op and date_ts is not None,
        height_op and height_val is not None,
    ])
    if not filters_present and not fetch_all:
        raise HTTPException(422, "At least one filter must be specified")

    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index files before using cleanup")

    q = db.query(File).filter(File.library_id == library_id)

    if duration_op and duration_secs is not None:
        if duration_op == "lt":
            q = q.filter(File.duration.isnot(None), File.duration < duration_secs)
        else:
            q = q.filter(File.duration.isnot(None), File.duration > duration_secs)

    if fps_op and fps_val is not None:
        if fps_op == "lt":
            q = q.filter(File.file_fps.isnot(None), File.file_fps < fps_val)
        else:
            q = q.filter(File.file_fps.isnot(None), File.file_fps > fps_val)

    if date_op and date_ts is not None:
        if date_op == "before":
            q = q.filter(File.file_date.isnot(None), File.file_date < date_ts)
        else:
            q = q.filter(File.file_date.isnot(None), File.file_date > date_ts)

    if height_op and height_val is not None:
        if height_op == "lt":
            q = q.filter(File.file_height.isnot(None), File.file_height < height_val)
        else:
            q = q.filter(File.file_height.isnot(None), File.file_height > height_val)

    files = q.order_by(File.filename).all()

    return [
        FileRead(
            id=f.id,
            library_id=f.library_id,
            path=f.path,
            filename=f.filename,
            size=f.size,
            duration=f.duration,
            codec_name=f.codec_name,
            video_bitrate=f.video_bitrate,
            status=f.status,
            scan_error=f.scan_error,
            scanned_at=f.scanned_at,
            transcoded_at=f.transcoded_at,
            created_at=f.created_at,
            has_thumbnail=os.path.exists(thumbnail_path(f.id)),
            file_width=f.file_width,
            file_height=f.file_height,
            file_fps=f.file_fps,
            file_date=f.file_date,
        )
        for f in files
        if os.path.exists(f.path)
    ]


@router.delete("/{library_id}/cleanup", status_code=204)
def delete_cleanup_files(
    library_id: int,
    body: DeleteDuplicatesRequest,
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    for file_id in body.file_ids:
        f = db.get(File, file_id)
        if not f or f.library_id != library_id:
            continue
        if os.path.exists(f.path):
            originals_dir = os.path.join(os.path.dirname(f.path), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            dest = os.path.join(originals_dir, f.filename)
            if os.path.exists(dest):
                base, ext = os.path.splitext(f.filename)
                dest = os.path.join(originals_dir, f"{base}_{f.id}{ext}")
            shutil.move(f.path, dest)
        delete_keyframes(f.id)
        db.query(VideoDetection).filter(VideoDetection.file_id == f.id).delete()
        db.delete(f)
    db.commit()
