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

    from app.services.subtitle_service import run_download_job

    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        settings=str({"path": body.path, "languages": lang_codes}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await enqueue(job.id, run_download_job, job.id, body.path, lang_codes)

    return {"job_id": job.id}


@router.post("/search-file")
def search_file(body: SearchFileRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    lang_codes = body.languages or _get_lang_codes(db)
    from app.services.subtitle_service import search_file as svc_search
    try:
        return svc_search(body.file_path, lang_codes)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/download-one")
def download_one(body: DownloadOneRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    from app.services.subtitle_service import download_one as svc_download
    try:
        ok = svc_download(body.file_path, body.provider, body.subtitle_id, body.language)
        if not ok:
            raise HTTPException(404, "Subtitle not found or download failed")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


class TranscribeFileRequest(BaseModel):
    file_path: str
    model_id: Optional[str] = None
    language: Optional[str] = None


class TranscribeBulkRequest(BaseModel):
    path: str
    model_id: Optional[str] = None
    language: Optional[str] = None


@router.post("/transcribe-file")
async def transcribe_file(body: TranscribeFileRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    model_id = body.model_id or get_setting(db, "whisper_model", "small")
    from app.services.model_manager import is_whisper_downloaded
    if not is_whisper_downloaded(model_id):
        raise HTTPException(422, f"Whisper model '{model_id}' not downloaded — get it in Settings → AI Models")
    job = Job(type=JobType.WHISPER_TRANSCRIBE, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)
    from app.services.subtitle_service import run_transcribe_job
    await enqueue(job.id, run_transcribe_job, job.id, [body.file_path], model_id, body.language)
    return {"job_id": job.id}


@router.post("/transcribe-bulk")
async def transcribe_bulk(body: TranscribeBulkRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")
    model_id = body.model_id or get_setting(db, "whisper_model", "small")
    from app.services.model_manager import is_whisper_downloaded
    if not is_whisper_downloaded(model_id):
        raise HTTPException(422, f"Whisper model '{model_id}' not downloaded — get it in Settings → AI Models")
    lang_codes = _get_lang_codes(db)
    from app.services.subtitle_service import scan_directory
    scan_result = scan_directory(body.path, lang_codes)
    missing = [f["path"] for f in scan_result if not f["has_subtitle"]]
    if not missing:
        raise HTTPException(422, "No files missing subtitles")
    job = Job(type=JobType.WHISPER_TRANSCRIBE, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)
    from app.services.subtitle_service import run_transcribe_job
    await enqueue(job.id, run_transcribe_job, job.id, missing, model_id, body.language)
    return {"job_id": job.id}


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
