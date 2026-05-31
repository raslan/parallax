import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import SessionLocal
from app.models.file import File
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.api.files import _to_file_read
from app.services.compressor import get_available_codecs, run_compress_job

router = APIRouter()


class CompressStartRequest(BaseModel):
    file_ids: list[int]
    codec: str = "hevc"
    crf: int = 28
    speed: str = "medium"
    keep_original: bool = True


@router.get("/compress/codecs")
def list_codecs():
    return get_available_codecs()


@router.get("/compress/library-files")
def library_files(library_id: int = Query(...)):
    """Return all files in a library, no pagination cap."""
    db = SessionLocal()
    try:
        files = (
            db.query(File)
            .filter(File.library_id == library_id)
            .order_by(File.filename)
            .all()
        )
        return [_to_file_read(f) for f in files]
    finally:
        db.close()


@router.post("/compress/start")
async def start_compress(req: CompressStartRequest):
    if not req.file_ids:
        raise HTTPException(422, "No files specified")

    db = SessionLocal()
    try:
        files = db.query(File).filter(File.id.in_(req.file_ids)).all()
        if len(files) != len(req.file_ids):
            raise HTTPException(422, "One or more file IDs not found")

        video_paths = [f.path for f in files]
        # Derive library_id from first file (all files should share one library)
        library_id = files[0].library_id if files else None

        settings = json.dumps({
            "codec": req.codec,
            "crf": req.crf,
            "speed": req.speed,
            "keep_original": req.keep_original,
        })
        job = Job(
            type=JobType.COMPRESS,
            status=JobStatus.PENDING,
            library_id=library_id,
            settings=settings,
            total_files=len(video_paths),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    await enqueue(job_id, run_compress_job, job_id, video_paths, req.codec, req.crf, req.speed, req.keep_original)

    return {"job_id": job_id}
