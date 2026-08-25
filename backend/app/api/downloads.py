import asyncio
import json
import os
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.download import Download, DownloadStatus
from app.models.settings import get_setting
from app.services.downloader import (
    _cleanup_part_files,
    cancel_download,
    fetch_playlist_info,
    get_ytdlp_info,
    install_ytdlp,
    list_impersonate_targets,
    run_download,
    unique_playlist_dir,
)

router = APIRouter(prefix="/downloads", tags=["downloads"])


class DownloadRequest(BaseModel):
    urls: list[str]
    output_dir: str | None = None
    audio_only: bool = False
    quality: str = "best"
    codec: str = "auto"  # video: auto/h264/hevc/av1/vp9; audio: mp3/m4a/opus
    trim_start: str | None = None
    trim_end: str | None = None
    download_subs: bool = False
    sub_langs: str = "en"
    extra_args: str = ""
    impersonate: str | None = None
    cookies: str = ""  # Netscape cookie text, ephemeral


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
        "source_url": d.source_url,
        "playlist_id": d.playlist_id,
        "playlist_title": d.playlist_title,
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

    playlist_results = await asyncio.gather(
        *[asyncio.to_thread(fetch_playlist_info, url) for url in req.urls]
    )

    for url, playlist_info in zip(req.urls, playlist_results):
        if playlist_info:
            # Reuse the same folder if this exact playlist was queued before (continuation);
            # otherwise pick a fresh, non-colliding name — sites without a real playlist
            # title all fall back to the same generic "playlist" name otherwise.
            existing = (
                db.query(Download)
                .filter(Download.playlist_id == playlist_info["playlist_id"])
                .first()
            )
            if existing:
                playlist_output_dir = existing.output_dir
            else:
                playlist_output_dir = await asyncio.to_thread(
                    unique_playlist_dir, output_dir, playlist_info["playlist_title"]
                )
            await asyncio.to_thread(lambda: os.makedirs(playlist_output_dir, exist_ok=True))

            for entry in playlist_info["entries"]:
                download = Download(
                    url=entry["url"],
                    title=entry.get("title"),
                    output_dir=playlist_output_dir,
                    status=DownloadStatus.PENDING,
                    options=json.dumps(options),
                    source_url=url,
                    playlist_id=playlist_info["playlist_id"],
                    playlist_title=playlist_info["playlist_title"],
                )
                db.add(download)
                db.flush()
                created_ids.append(download.id)
        else:
            download = Download(
                url=url,
                output_dir=output_dir,
                status=DownloadStatus.PENDING,
                options=json.dumps(options),
                source_url=url,
            )
            db.add(download)
            db.flush()
            created_ids.append(download.id)

    db.commit()

    for download_id in created_ids:
        asyncio.create_task(run_download(download_id, max_concurrent))

    return {"ids": created_ids}


@router.post("/retry-failed")
async def retry_all_failed(db: Session = Depends(get_db)):
    """Re-queue every failed/cancelled download in one shot.

    Copies url/options straight from the old row (no re-probing the URL —
    it's already a resolved single video, not a playlist), then drops the
    old row so it doesn't linger alongside the retry.
    """
    max_concurrent = int(get_setting(db, "max_concurrent_downloads", "2"))
    old_rows = (
        db.query(Download)
        .filter(Download.status.in_([DownloadStatus.FAILED, DownloadStatus.CANCELLED]))
        .all()
    )

    created_ids: list[int] = []
    for old in old_rows:
        new = Download(
            url=old.url,
            title=old.title,
            output_dir=old.output_dir,
            status=DownloadStatus.PENDING,
            options=old.options,
            source_url=old.source_url,
            playlist_id=old.playlist_id,
            playlist_title=old.playlist_title,
        )
        db.add(new)
        db.flush()
        created_ids.append(new.id)
        db.delete(old)

    db.commit()

    for download_id in created_ids:
        asyncio.create_task(run_download(download_id, max_concurrent))

    return {"ids": created_ids}


@router.post("/stop-all")
def stop_all_downloads(db: Session = Depends(get_db)):
    """Cancel all pending/running downloads and drop records (not resumable)."""
    active = (
        db.query(Download)
        .filter(Download.status.in_([DownloadStatus.PENDING, DownloadStatus.RUNNING]))
        .all()
    )

    for d in active:
        cancel_download(d.id)
        _cleanup_part_files(d.output_dir, d.title)
        db.delete(d)

    db.commit()
    return {"stopped": len(active)}


@router.get("/stream")
async def stream_downloads():
    """SSE stream pushing all download states every 500ms while any are active."""

    async def generate():
        last_payload = None
        idle_ticks = 0
        while True:
            # Open/close per tick rather than holding one connection for the
            # whole (potentially indefinite) SSE lifetime — a handful of open
            # tabs/reconnects would otherwise exhaust the pool.
            db = SessionLocal()
            try:
                downloads = db.query(Download).order_by(Download.created_at.desc()).limit(200).all()
                active_statuses = {DownloadStatus.PENDING, DownloadStatus.RUNNING}
                any_active = any(d.status in active_statuses for d in downloads)
                payload = json.dumps([_serialize(d) for d in downloads])
            finally:
                db.close()

            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
                idle_ticks = 0
            else:
                idle_ticks += 1

            delay = 0.5 if any_active else min(2.0 + idle_ticks * 0.5, 5.0)
            await asyncio.sleep(delay)

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


@router.get("/{download_id}/thumbnail")
async def thumbnail(download_id: int, db: Session = Depends(get_db)):
    download = db.get(Download, download_id)
    if not download or not download.thumbnail_url:
        raise HTTPException(404, "No thumbnail")

    def _fetch():
        req = urllib.request.Request(download.thumbnail_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read(), resp.headers.get("Content-Type", "image/jpeg")

    try:
        data, content_type = await asyncio.to_thread(_fetch)
    except Exception:
        raise HTTPException(502, "Could not fetch thumbnail")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "no-store"})


@router.get("/{download_id}/stream")
def stream_file(download_id: int, db: Session = Depends(get_db)):
    download = db.get(Download, download_id)
    if not download:
        raise HTTPException(404, "Download not found")
    if not download.output_path or not os.path.isfile(download.output_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(download.output_path)


@router.delete("/{download_id}", status_code=204)
def cancel_download_route(
    download_id: int,
    delete_file: bool = False,
    db: Session = Depends(get_db),
):
    download = db.get(Download, download_id)
    if not download:
        raise HTTPException(404, "Download not found")

    # Cancel if active and clean up part files — do this before deleting the record
    # because _run_download_sync will see None from db.get() and return early
    if download.status in (DownloadStatus.PENDING, DownloadStatus.RUNNING):
        cancel_download(download_id)
        _cleanup_part_files(download.output_dir, download.title)

    # Optionally delete the file on disk
    if delete_file and download.output_path and os.path.isfile(download.output_path):
        try:
            os.remove(download.output_path)
        except OSError:
            pass

    db.delete(download)
    db.commit()
