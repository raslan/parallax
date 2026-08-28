import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import asc, desc, func, nullslast
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.utils import active_job_exists
from app.database import SessionLocal, get_db
from app.models.file import File
from app.models.job import JobType
from app.schemas import FileRead, FilesResponse
from app.services.scanner import thumbnail_path

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/stream")
async def stream_files(library_id: int | None = Query(None)):
    """SSE stream that pushes a cheap signature of `files` state — callers diff
    it against their last-seen value and refetch their own file list on change.
    Signature changes on any insert, delete, or update (including in-place
    field changes like a rescan after Compress/Toolbox/restore), because it's
    computed from current DB state rather than emitted by whichever endpoint
    happened to cause the change — no call site anywhere has to remember to
    signal this stream."""

    async def generate():
        last_payload = None
        idle_ticks = 0
        while True:

            def _compute_signature():
                db = SessionLocal()
                try:
                    q = db.query(func.count(File.id), func.max(File.id), func.max(File.updated_at))
                    if library_id is not None:
                        q = q.filter(File.library_id == library_id)
                    count, max_id, max_updated = q.one()
                    return f"{count}:{max_id}:{max_updated.isoformat() if max_updated else ''}"
                finally:
                    db.close()

            payload = await run_in_threadpool(_compute_signature)

            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
                idle_ticks = 0
            else:
                idle_ticks += 1
                if idle_ticks >= 7:
                    yield ": keepalive\n\n"
                    idle_ticks = 0

            await asyncio.sleep(2.0)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
        file_width=f.file_width,
        file_height=f.file_height,
        file_fps=f.file_fps,
        file_date=f.file_date,
    )


_SORT_COLUMNS = {
    "filename": File.filename,
    "size": File.size,
    "duration": File.duration,
    "video_bitrate": File.video_bitrate,
    "created_at": File.created_at,
    "extension": File.extension,
}


@router.get("", response_model=FilesResponse)
def list_files(
    library_id: int | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10000),
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


@router.get("/search")
def search_files(
    q: str = Query(..., min_length=1),
    library_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=100000),
    exclude: bool = Query(False, description="Return least similar files instead of most similar"),
    db: Session = Depends(get_db),
):
    from app.models.settings import get_setting
    from app.services.image_analyzer import cosine_similarity, encode_text_clip

    clip_model_id = get_setting(db, "clip_model", "clip-vit-base-patch32")
    text_vec = encode_text_clip(q, model_id=clip_model_id)

    query = db.query(File).filter(File.clip_embedding.isnot(None))
    if library_id is not None:
        query = query.filter(File.library_id == library_id)

    scored = []
    for f in query.all():
        try:
            score = cosine_similarity(text_vec, json.loads(f.clip_embedding))
            scored.append((f, score))
        except Exception:
            continue

    scored.sort(key=lambda x: x[1], reverse=not exclude)
    return [{"file": _to_file_read(f), "score": round(score, 4)} for f, score in scored[:limit]]


@router.get("/detections")
def filter_by_detections(
    labels: str = Query(..., description="Comma-separated NudeNet labels"),
    min_confidence: float = Query(0.5, ge=0.0, le=1.0),
    exclude: bool = Query(False, description="Return files that do NOT match the criteria"),
    library_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    from app.models.video import VideoDetection

    label_list = [label.strip() for label in labels.split(",") if label.strip()]
    if not label_list:
        raise HTTPException(400, "At least one label is required")

    matching_ids = (
        db.query(VideoDetection.file_id)
        .filter(
            VideoDetection.label.in_(label_list),
            VideoDetection.confidence >= min_confidence,
        )
        .distinct()
        .subquery()
    )

    id_filter = File.id.notin_(matching_ids) if exclude else File.id.in_(matching_ids)
    q = db.query(File).filter(id_filter)
    if library_id is not None:
        q = q.filter(File.library_id == library_id)

    total = q.with_entities(func.count(File.id)).scalar()
    items = q.order_by(File.filename).offset((page - 1) * page_size).limit(page_size).all()

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
    return FileResponse(thumb, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/{file_id}/check", status_code=202)
async def check_file_endpoint(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if f.library_id and active_job_exists(db, f.library_id, JobType.CHECK):
        raise HTTPException(409, "A check job is already running")
    from app.queue import enqueue
    from app.services.corruption import check_file

    await enqueue(None, check_file, file_id)
    return {"message": "Check queued"}


@router.get("/{file_id}/stream")
def stream_file(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    if not os.path.exists(f.path):
        raise HTTPException(404, "File not found on disk")
    from app.services.stream_cache import get_stream_path

    return FileResponse(get_stream_path(f.path), headers={"Cache-Control": "no-store"})


@router.get("/{file_id}/subtitle")
def get_subtitle(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    from app.services.subtitle_service import find_and_serve_vtt

    vtt = find_and_serve_vtt(f.path)
    if vtt is None:
        raise HTTPException(404, "No subtitle found")
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


@router.get("/{file_id}/subtitle-tracks")
def get_subtitle_tracks(file_id: int, db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    from urllib.parse import quote

    from app.services.subtitle_service import find_all_subtitle_tracks

    tracks = find_all_subtitle_tracks(f.path)
    return [
        {
            "label": t["label"],
            "lang": t["lang"],
            "url": f"/api/subtitles/vtt?path={quote(t['path'])}",
        }
        for t in tracks
    ]
