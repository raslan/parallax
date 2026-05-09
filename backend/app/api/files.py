import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, asc, desc, nullslast

from app.database import get_db
from app.models.file import File, FileStatus
from app.models.job import Job, JobStatus, JobType
from app.schemas import FilesResponse, FileRead, TranscodeRequest
from app.services.scanner import thumbnail_path
from app.api.utils import active_job_exists

router = APIRouter(prefix="/files", tags=["files"])


def _to_file_read(f: File) -> FileRead:
    thumb = thumbnail_path(f.id)
    return FileRead(
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
        has_thumbnail=os.path.exists(thumb),
    )


_SORT_COLUMNS = {
    "filename":      File.filename,
    "size":          File.size,
    "duration":      File.duration,
    "video_bitrate": File.video_bitrate,
    "created_at":    File.created_at,
}


@router.get("", response_model=FilesResponse)
def list_files(
    library_id: int | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("filename"),
    sort_dir: str = Query("asc"),
    db: Session = Depends(get_db),
):
    q = db.query(File)
    if library_id is not None:
        q = q.filter(File.library_id == library_id)
    if status:
        q = q.filter(File.status == status)

    col = _SORT_COLUMNS.get(sort_by, File.filename)
    order = nullslast(desc(col)) if sort_dir == "desc" else nullslast(asc(col))

    total = q.with_entities(func.count(File.id)).scalar()
    items = q.order_by(order).offset((page - 1) * page_size).limit(page_size).all()

    return FilesResponse(
        items=[_to_file_read(f) for f in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{file_id}/thumbnail")
def get_thumbnail(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    thumb = thumbnail_path(file_id)
    if not os.path.exists(thumb):
        raise HTTPException(404, "Thumbnail not available")
    return FileResponse(thumb, media_type="image/jpeg")


@router.post("/{file_id}/check", status_code=202)
async def check_file_endpoint(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if f.library_id and active_job_exists(db, f.library_id, JobType.CHECK):
        raise HTTPException(409, "A check job is already running")
    from app.services.corruption import check_file
    from app.queue import enqueue
    await enqueue(None, check_file, file_id)
    return {"message": "Check queued"}


@router.post("/{file_id}/transcode", status_code=202)
async def transcode_file_endpoint(file_id: int, body: TranscodeRequest, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if f.status in (FileStatus.TRANSCODING, FileStatus.QUEUED):
        raise HTTPException(409, "This file is already queued for transcoding")
    job = Job(type=JobType.TRANSCODE, status=JobStatus.PENDING, library_id=f.library_id, settings=body.preset)
    db.add(job)
    f.status = FileStatus.QUEUED
    db.commit()
    db.refresh(job)
    from app.services.transcoder import transcode_file
    from app.queue import enqueue
    await enqueue(job.id, transcode_file, file_id, body.preset, job.id)
    return {"message": "Transcode queued"}


@router.get("/{file_id}/stream")
def stream_file(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if not os.path.exists(f.path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(f.path)
