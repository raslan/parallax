import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import SessionLocal
from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services.toolbox import run_toolbox_job

router = APIRouter()


class ToolboxStartRequest(BaseModel):
    file_ids: list[int]
    trim_start: float = 0
    trim_end: float = 0
    audio_channel: str | None = None  # "auto" | "left" | "right" | None
    rotate_deg: int | None = None     # 90 | 180 | 270
    normalize: bool = False
    faststart: bool = False
    sync_offset_ms: float | None = None
    keep_original: bool = True


@router.post("/toolbox/start")
async def start_toolbox(req: ToolboxStartRequest):
    if not req.file_ids:
        raise HTTPException(422, "No files specified")

    if req.audio_channel not in (None, "auto", "left", "right"):
        raise HTTPException(422, "audio_channel must be one of: auto, left, right")
    if req.rotate_deg not in (None, 90, 180, 270):
        raise HTTPException(422, "rotate_deg must be one of: 90, 180, 270")

    has_fix = (
        req.trim_start > 0 or req.trim_end > 0
        or req.audio_channel is not None
        or req.rotate_deg is not None
        or req.normalize
        or req.faststart
        or req.sync_offset_ms is not None
    )
    if not has_fix:
        raise HTTPException(422, "No fix selected")

    db = SessionLocal()
    try:
        files = db.query(File).filter(File.id.in_(req.file_ids)).all()
        if len(files) != len(req.file_ids):
            raise HTTPException(422, "One or more file IDs not found")

        video_paths = [f.path for f in files]
        library_id = files[0].library_id if files else None

        settings = {
            "trim_start": req.trim_start,
            "trim_end": req.trim_end,
            "audio_channel": req.audio_channel,
            "rotate_deg": req.rotate_deg,
            "normalize": req.normalize,
            "faststart": req.faststart,
            "sync_offset_ms": req.sync_offset_ms,
        }
        job = Job(
            type=JobType.TOOLBOX_FIX,
            status=JobStatus.PENDING,
            library_id=library_id,
            settings=json.dumps(settings),
            total_files=len(video_paths),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    await enqueue(job_id, run_toolbox_job, job_id, video_paths, settings, req.keep_original)

    return {"job_id": job_id}
