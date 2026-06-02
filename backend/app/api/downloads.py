import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.download import Download, DownloadStatus
from app.models.settings import get_setting
from app.services.downloader import cancel_download, get_ytdlp_info, install_ytdlp, list_impersonate_targets, run_download

router = APIRouter(prefix="/downloads", tags=["downloads"])


class DownloadRequest(BaseModel):
    urls: list[str]
    output_dir: str | None = None
    audio_only: bool = False
    quality: str = "best"
    codec: str = "auto"          # video: auto/h264/hevc/av1/vp9; audio: mp3/m4a/opus
    trim_start: str | None = None
    trim_end: str | None = None
    download_subs: bool = False
    sub_langs: str = "en"
    extra_args: str = ""
    impersonate: str | None = None
    cookies: str = ""            # Netscape cookie text, ephemeral


def _serialize(d: Download) -> dict:
    return {
        "id": d.id,
        "url": d.url,
        "title": d.title,
        "uploader": d.uploader,
        "thumbnail_url": d.thumbnail_url,
        "duration": d.duration,
        "status": d.status,
        "progress": d.progress,
        "speed": d.speed,
        "eta": d.eta,
        "error": d.error,
        "output_path": d.output_path,
        "output_dir": d.output_dir,
        "options": d.options,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "started_at": d.started_at.isoformat() if d.started_at else None,
        "finished_at": d.finished_at.isoformat() if d.finished_at else None,
    }


@router.get("")
def list_downloads(db: Session = Depends(get_db)):
    downloads = db.query(Download).order_by(Download.created_at.desc()).limit(200).all()
    return [_serialize(d) for d in downloads]


@router.post("")
async def enqueue_downloads(req: DownloadRequest, db: Session = Depends(get_db)):
    output_dir = req.output_dir
    if not output_dir:
        output_dir = get_setting(db, "download_dir", "/downloads")
    max_concurrent = int(get_setting(db, "max_concurrent_downloads", "2"))

    options = {
        "audio_only": req.audio_only,
        "quality": req.quality,
        "codec": req.codec,
        "trim_start": req.trim_start,
        "trim_end": req.trim_end,
        "download_subs": req.download_subs,
        "sub_langs": req.sub_langs,
        "extra_args": req.extra_args,
        "impersonate": req.impersonate,
        "cookies": req.cookies,
    }

    created_ids: list[int] = []
    for url in req.urls:
        download = Download(
            url=url,
            output_dir=output_dir,
            status=DownloadStatus.PENDING,
            options=json.dumps(options),
        )
        db.add(download)
        db.flush()
        created_ids.append(download.id)
    db.commit()

    for download_id in created_ids:
        asyncio.create_task(run_download(download_id, max_concurrent))

    return {"ids": created_ids}


@router.get("/stream")
async def stream_downloads():
    """SSE stream pushing all download states every 500ms while any are active."""

    async def generate():
        db = SessionLocal()
        try:
            last_payload = None
            idle_ticks = 0
            while True:
                db.expire_all()
                downloads = db.query(Download).order_by(Download.created_at.desc()).limit(200).all()

                active_statuses = {DownloadStatus.PENDING, DownloadStatus.RUNNING}
                any_active = any(d.status in active_statuses for d in downloads)

                payload = json.dumps([_serialize(d) for d in downloads])

                if payload != last_payload:
                    yield f"data: {payload}\n\n"
                    last_payload = payload
                    idle_ticks = 0
                else:
                    idle_ticks += 1

                delay = 0.5 if any_active else min(2.0 + idle_ticks * 0.5, 5.0)
                await asyncio.sleep(delay)
        finally:
            db.close()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/ytdlp/info")
def ytdlp_info():
    return get_ytdlp_info()


@router.get("/ytdlp/impersonate-targets")
async def ytdlp_impersonate_targets():
    targets = await asyncio.to_thread(list_impersonate_targets)
    return {"targets": targets}


@router.post("/ytdlp/update")
async def ytdlp_update(db: Session = Depends(get_db)):
    channel = get_setting(db, "ytdlp_channel", "stable")
    await asyncio.to_thread(install_ytdlp, channel)
    return {"message": f"yt-dlp updated ({channel})"}


@router.get("/{download_id}/stream")
def stream_file(download_id: int, db: Session = Depends(get_db)):
    download = db.get(Download, download_id)
    if not download:
        raise HTTPException(404, "Download not found")
    if not download.output_path or not os.path.isfile(download.output_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(download.output_path)


@router.delete("/{download_id}", status_code=204)
def cancel_download_route(download_id: int, db: Session = Depends(get_db)):
    download = db.get(Download, download_id)
    if not download:
        raise HTTPException(404, "Download not found")

    # Cancel if active
    if download.status in (DownloadStatus.PENDING, DownloadStatus.RUNNING):
        cancel_download(download_id)

    # Always delete the record
    db.delete(download)
    db.commit()
