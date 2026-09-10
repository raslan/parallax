import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services.audio_toolbox import CHANNEL_OPS, run_audio_toolbox_job

router = APIRouter(prefix="/audio-toolbox", tags=["audio-toolbox"])


class AudioToolboxStartRequest(BaseModel):
    file_ids: list[int]
    trim_start: float = 0
    trim_end: float = 0
    channel_op: str | None = None
    normalize: bool = False
    keep_original: bool = True


@router.post("/start")
async def start_audio_toolbox(req: AudioToolboxStartRequest, db: Session = Depends(get_db)):
    if not req.file_ids:
        raise HTTPException(422, "No files specified")
    if req.channel_op is not None and req.channel_op not in CHANNEL_OPS:
        raise HTTPException(422, f"channel_op must be one of: {', '.join(CHANNEL_OPS)}")

    has_fix = req.trim_start > 0 or req.trim_end > 0 or req.channel_op is not None or req.normalize
    if not has_fix:
        raise HTTPException(422, "No fix selected")

    files = db.query(AudioFile).filter(AudioFile.id.in_(req.file_ids)).all()
    if len(files) != len(set(req.file_ids)):
        raise HTTPException(422, "One or more file IDs not found")
    library_ids = {f.library_id for f in files}
    if len(library_ids) != 1:
        raise HTTPException(422, "All files must belong to one library")
    for f in files:
        if req.trim_start + req.trim_end >= (f.duration or 0):
            raise HTTPException(422, f"Trim leaves nothing of {f.filename}")

    settings = {
        "trim_start": req.trim_start,
        "trim_end": req.trim_end,
        "channel_op": req.channel_op,
        "normalize": req.normalize,
    }
    job = Job(
        type=JobType.AUDIO_TOOLBOX,
        status=JobStatus.PENDING,
        library_id=library_ids.pop(),
        settings=json.dumps(settings),
        total_files=len(files),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    job_id = job.id

    await enqueue(job_id, run_audio_toolbox_job, job_id, req.file_ids, settings, req.keep_original)
    return {"job_id": job_id}
