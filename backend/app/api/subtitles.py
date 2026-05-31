import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.models.settings import get_setting
from app.queue import enqueue

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

_OS_USERNAME_KEY = "opensubtitles_username"
_OS_PASSWORD_KEY  = "opensubtitles_password"
_SUBTITLE_LANGUAGES_KEY = "subtitle_languages"
_SUBTITLE_LANGUAGES_DEFAULT = "en"


def _get_lang_codes(db: Session) -> list[str]:
    raw = get_setting(db, _SUBTITLE_LANGUAGES_KEY, _SUBTITLE_LANGUAGES_DEFAULT)
    return [c.strip() for c in raw.split(",") if c.strip()]


class ScanRequest(BaseModel):
    path: str


class DownloadRequest(BaseModel):
    path: str
    languages: Optional[list[str]] = None


class SearchFileRequest(BaseModel):
    file_path: str
    languages: Optional[list[str]] = None


class DownloadOneRequest(BaseModel):
    file_path: str
    provider: str
    subtitle_id: str
    language: str


@router.post("/scan")
def scan_path(body: ScanRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")
    from app.services.subtitle_service import scan_directory
    return scan_directory(body.path, _get_lang_codes(db))


@router.post("/download")
async def download_subtitles(body: DownloadRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")

    lang_codes = body.languages or _get_lang_codes(db)
    os_username = get_setting(db, _OS_USERNAME_KEY, "")
    os_password = get_setting(db, _OS_PASSWORD_KEY, "")

    from app.services.subtitle_service import run_download_job

    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        settings=str({"path": body.path, "languages": lang_codes}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await enqueue(job.id, run_download_job, job.id, body.path, lang_codes, os_username, os_password)

    return {"job_id": job.id}


@router.post("/search-file")
def search_file(body: SearchFileRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    lang_codes = body.languages or _get_lang_codes(db)
    os_username = get_setting(db, _OS_USERNAME_KEY, "")
    os_password = get_setting(db, _OS_PASSWORD_KEY, "")
    from app.services.subtitle_service import search_file as svc_search
    try:
        return svc_search(body.file_path, lang_codes, os_username, os_password)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/download-one")
def download_one(body: DownloadOneRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    os_username = get_setting(db, _OS_USERNAME_KEY, "")
    os_password = get_setting(db, _OS_PASSWORD_KEY, "")
    from app.services.subtitle_service import download_one as svc_download
    try:
        ok = svc_download(body.file_path, body.provider, body.subtitle_id, body.language, os_username, os_password)
        if not ok:
            raise HTTPException(404, "Subtitle not found or download failed")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/tracks")
def tracks_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Return all subtitle tracks for a video at an arbitrary path."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    from urllib.parse import quote
    from app.services.subtitle_service import find_all_subtitle_tracks
    tracks = find_all_subtitle_tracks(path)
    return [
        {"label": t["label"], "lang": t["lang"], "url": f"/api/subtitles/vtt?path={quote(t['path'])}"}
        for t in tracks
    ]


@router.get("/vtt")
def serve_vtt_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Serve subtitle as WebVTT for a video at an arbitrary path."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    from app.services.subtitle_service import find_and_serve_vtt
    vtt = find_and_serve_vtt(path)
    if vtt is None:
        raise HTTPException(404, "No subtitle found")
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


@router.get("/stream")
def stream_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Stream a video file at an arbitrary path (for subtitle preview)."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)
