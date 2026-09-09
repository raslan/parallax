import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.audio_files import _to_audio_read
from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services.audio_compressor import get_available_audio_codecs, run_audio_compress_job

router = APIRouter()


class AudioCompressStartRequest(BaseModel):
    file_ids: list[int]
    codec: str = "opus"
    bitrate: int = 128
    keep_original: bool = True


@router.get("/audio-compress/codecs")
def list_codecs():
    return get_available_audio_codecs()


@router.get("/audio-compress/library-files")
def library_files(library_id: int = Query(...)):
    """Return all audio files in a library, no pagination cap."""
    db = SessionLocal()
    try:
        files = (
            db.query(AudioFile)
            .filter(AudioFile.library_id == library_id)
            .order_by(AudioFile.filename)
            .all()
        )
        return [_to_audio_read(f) for f in files]
    finally:
        db.close()


@router.post("/audio-compress/start")
async def start_audio_compress(req: AudioCompressStartRequest):
    if not req.file_ids:
        raise HTTPException(422, "No files specified")

    db = SessionLocal()
    try:
        files = db.query(AudioFile).filter(AudioFile.id.in_(req.file_ids)).all()
        if len(files) != len(req.file_ids):
            raise HTTPException(422, "One or more file IDs not found")

        audio_paths = [f.path for f in files]
        # Derive library_id from first file (all files should share one library)
        library_id = files[0].library_id if files else None

        settings = json.dumps(
            {
                "codec": req.codec,
                "bitrate": req.bitrate,
                "keep_original": req.keep_original,
            }
        )
        job = Job(
            type=JobType.AUDIO_COMPRESS,
            status=JobStatus.PENDING,
            library_id=library_id,
            settings=settings,
            total_files=len(audio_paths),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    await enqueue(
        job_id,
        run_audio_compress_job,
        job_id,
        audio_paths,
        req.codec,
        req.bitrate,
        req.keep_original,
    )

    return {"job_id": job_id}
