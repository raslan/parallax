import asyncio
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import SessionLocal, get_db
from app.models.audio_file import AudioFile
from app.schemas import AudioFileRead

router = APIRouter(prefix="/audio-files", tags=["audio-files"])


@router.get("/stream")
async def stream_audio_files(library_id: int | None = Query(None)):
    """SSE stream that pushes a cheap signature of `audio_files` state — callers
    diff it against their last-seen value and refetch their own file list on
    change. Signature changes on any insert, delete, or update (including
    in-place field changes like a rescan), because it's computed from current DB
    state rather than emitted by whichever endpoint happened to cause the change
    — no call site anywhere has to remember to signal this stream."""

    async def generate():
        last_payload = None
        idle_ticks = 0
        while True:

            def _compute_signature():
                db = SessionLocal()
                try:
                    q = db.query(
                        func.count(AudioFile.id),
                        func.max(AudioFile.id),
                        func.max(AudioFile.updated_at),
                    )
                    if library_id is not None:
                        q = q.filter(AudioFile.library_id == library_id)
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


def _to_audio_read(f: AudioFile) -> AudioFileRead:
    return AudioFileRead.model_validate(f)


@router.get("", response_model=list[AudioFileRead])
def list_audio_files(
    library_id: int = Query(...),
    db: Session = Depends(get_db),
):
    items = (
        db.query(AudioFile)
        .filter(AudioFile.library_id == library_id)
        .order_by(AudioFile.filename)
        .all()
    )
    return [_to_audio_read(f) for f in items]


@router.get("/{file_id}/stream")
def stream_audio_file(file_id: int, db: Session = Depends(get_db)):
    f = db.get(AudioFile, file_id)
    if not f or not os.path.isfile(f.path):
        raise HTTPException(404, "File not found")
    return FileResponse(f.path, headers={"Cache-Control": "no-store"})


class AudioFileDeleteRequest(BaseModel):
    file_ids: list[int]
    keep_original: bool = True


@router.post("/delete", status_code=204)
def delete_audio_files(body: AudioFileDeleteRequest, db: Session = Depends(get_db)):
    for file_id in body.file_ids:
        row = db.get(AudioFile, file_id)
        if row is None:
            continue
        if os.path.isfile(row.path):
            if body.keep_original:
                originals_dir = os.path.join(os.path.dirname(row.path), "_originals")
                os.makedirs(originals_dir, exist_ok=True)
                dest = os.path.join(originals_dir, row.filename)
                if os.path.exists(dest):
                    base, ext = os.path.splitext(row.filename)
                    dest = os.path.join(originals_dir, f"{base}_{row.id}{ext}")
                    n = 1
                    while os.path.exists(dest):
                        dest = os.path.join(originals_dir, f"{base}_{row.id}_{n}{ext}")
                        n += 1
                shutil.move(row.path, dest)
            else:
                try:
                    os.remove(row.path)
                except FileNotFoundError:
                    pass
        db.delete(row)
    db.commit()
