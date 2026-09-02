from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.models.settings import get_setting, set_setting
from app.services.model_manager import (
    NUDENET_MODELS,
    WHISPER_MODELS,
    delete_nudenet,
    delete_whisper,
    is_nudenet_downloaded,
    is_whisper_downloaded,
)

router = APIRouter(prefix="/models", tags=["models"])

_NUDENET_SETTING = "nudenet_model"
_NUDENET_DEFAULT = "320n"
_WHISPER_SETTING = "whisper_model"
_WHISPER_DEFAULT = "small"


class ModelInfo(BaseModel):
    id: str
    type: str  # "nudenet" or "whisper"
    name: str
    description: str
    size_mb: int
    quality: str
    downloaded: bool
    active: bool
    bundled: bool = False


class ActiveDownloadInfo(BaseModel):
    job_id: int
    model_type: str
    model_id: str
    status: str
    progress: float
    current_file: str | None


@router.get("/active-download", response_model=ActiveDownloadInfo | None)
def get_active_download(db: Session = Depends(get_db)):
    """Returns the currently pending/running model download job, if any."""
    job = (
        db.query(Job)
        .filter(
            Job.type == JobType.MODEL_DOWNLOAD,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .order_by(Job.id.desc())
        .first()
    )
    if not job or not job.settings:
        return None
    parts = job.settings.split(":", 1)
    if len(parts) != 2:
        return None
    return ActiveDownloadInfo(
        job_id=job.id,
        model_type=parts[0],
        model_id=parts[1],
        status=job.status,
        progress=job.progress,
        current_file=job.current_file,
    )


@router.get("", response_model=list[ModelInfo])
def list_models(db: Session = Depends(get_db)):
    active_nudenet = get_setting(db, _NUDENET_SETTING, _NUDENET_DEFAULT)
    active_whisper = get_setting(db, _WHISPER_SETTING, _WHISPER_DEFAULT)

    result: list[ModelInfo] = []
    for m in NUDENET_MODELS.values():
        result.append(
            ModelInfo(
                id=m["id"],
                type="nudenet",
                name=m["name"],
                description=m["description"],
                size_mb=m["size_mb"],
                quality=m["quality"],
                downloaded=is_nudenet_downloaded(m["id"]),
                active=(m["id"] == active_nudenet),
                bundled=m.get("bundled", False),
            )
        )
    for m in WHISPER_MODELS.values():
        result.append(
            ModelInfo(
                id=m["id"],
                type="whisper",
                name=m["name"],
                description=m["description"],
                size_mb=m["size_mb"],
                quality=m["quality"],
                downloaded=is_whisper_downloaded(m["id"]),
                active=(m["id"] == active_whisper),
            )
        )
    return result


@router.post("/nudenet/{model_id}/download", status_code=202)
async def download_nudenet_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in NUDENET_MODELS:
        raise HTTPException(404, "Unknown NudeNet model")
    if is_nudenet_downloaded(model_id):
        raise HTTPException(409, "Model already downloaded")

    running = (
        db.query(Job)
        .filter(
            Job.type == JobType.MODEL_DOWNLOAD,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .first()
    )
    if running:
        raise HTTPException(409, "A model download is already in progress")

    job = Job(type=JobType.MODEL_DOWNLOAD, status=JobStatus.PENDING, settings=f"nudenet:{model_id}")
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.queue import enqueue
    from app.services.model_manager import download_nudenet

    await enqueue(job.id, download_nudenet, model_id, job.id)
    return {"job_id": job.id}


@router.delete("/nudenet/{model_id}", status_code=204)
def delete_nudenet_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in NUDENET_MODELS:
        raise HTTPException(404, "Unknown NudeNet model")
    if NUDENET_MODELS[model_id].get("bundled"):
        raise HTTPException(409, "Bundled models cannot be deleted")
    active = get_setting(db, _NUDENET_SETTING, _NUDENET_DEFAULT)
    if model_id == active:
        raise HTTPException(409, "Cannot delete the active model — switch to another first")
    if not is_nudenet_downloaded(model_id):
        raise HTTPException(404, "Model not downloaded")
    try:
        delete_nudenet(model_id)
    except OSError as e:
        raise HTTPException(500, f"Failed to delete model: {e}")


@router.post("/whisper/{model_id}/download", status_code=202)
async def download_whisper_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in WHISPER_MODELS:
        raise HTTPException(404, "Unknown Whisper model")
    if is_whisper_downloaded(model_id):
        raise HTTPException(409, "Model already downloaded")
    running = (
        db.query(Job)
        .filter(
            Job.type == JobType.MODEL_DOWNLOAD,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .first()
    )
    if running:
        raise HTTPException(409, "A model download is already in progress")
    job = Job(type=JobType.MODEL_DOWNLOAD, status=JobStatus.PENDING, settings=f"whisper:{model_id}")
    db.add(job)
    db.commit()
    db.refresh(job)
    from app.queue import enqueue
    from app.services.model_manager import download_whisper

    await enqueue(job.id, download_whisper, model_id, job.id)
    return {"job_id": job.id}


@router.delete("/whisper/{model_id}", status_code=204)
def delete_whisper_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in WHISPER_MODELS:
        raise HTTPException(404, "Unknown Whisper model")
    active = get_setting(db, _WHISPER_SETTING, _WHISPER_DEFAULT)
    if model_id == active:
        raise HTTPException(409, "Cannot delete the active model — switch to another first")
    if not is_whisper_downloaded(model_id):
        raise HTTPException(404, "Model not downloaded")
    try:
        delete_whisper(model_id)
    except OSError as e:
        raise HTTPException(500, f"Failed to delete model: {e}")


@router.post("/whisper/{model_id}/activate", status_code=200)
def activate_whisper_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in WHISPER_MODELS:
        raise HTTPException(404, "Unknown Whisper model")
    if not is_whisper_downloaded(model_id):
        raise HTTPException(422, "Model not downloaded yet")
    set_setting(db, _WHISPER_SETTING, model_id)
    return {"active": model_id}
