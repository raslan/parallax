import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.models.settings import get_setting
from app.queue import enqueue

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

_OS_API_KEY = "opensubtitles_api_key"
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
    os_api_key = get_setting(db, _OS_API_KEY, "")

    from app.services.subtitle_service import run_download_job

    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        settings=str({"path": body.path, "languages": lang_codes}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await enqueue(job.id, run_download_job, job.id, body.path, lang_codes, os_api_key)

    return {"job_id": job.id}
