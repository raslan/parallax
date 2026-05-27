from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.models.settings import get_setting
from app.services.model_manager import (
    CLIP_MODELS, NUDENET_MODELS,
    is_clip_downloaded, is_nudenet_downloaded,
    delete_clip, delete_nudenet,
)

router = APIRouter(prefix="/models", tags=["models"])

_CLIP_SETTING = "clip_model"
_CLIP_DEFAULT = "clip-vit-base-patch32"
_NUDENET_SETTING = "nudenet_model"
_NUDENET_DEFAULT = "320n"


class ModelInfo(BaseModel):
    id: str
    type: str          # "clip" or "nudenet"
    name: str
    description: str
    size_mb: int
    quality: str
    downloaded: bool
    active: bool
    bundled: bool = False


@router.get("", response_model=list[ModelInfo])
def list_models(db: Session = Depends(get_db)):
    active_clip = get_setting(db, _CLIP_SETTING, _CLIP_DEFAULT)
    active_nudenet = get_setting(db, _NUDENET_SETTING, _NUDENET_DEFAULT)

    result: list[ModelInfo] = []
    for m in CLIP_MODELS.values():
        result.append(ModelInfo(
            id=m["id"], type="clip", name=m["name"],
            description=m["description"], size_mb=m["size_mb"],
            quality=m["quality"], downloaded=is_clip_downloaded(m["id"]),
            active=(m["id"] == active_clip),
        ))
    for m in NUDENET_MODELS.values():
        result.append(ModelInfo(
            id=m["id"], type="nudenet", name=m["name"],
            description=m["description"], size_mb=m["size_mb"],
            quality=m["quality"], downloaded=is_nudenet_downloaded(m["id"]),
            active=(m["id"] == active_nudenet),
            bundled=m.get("bundled", False),
        ))
    return result


@router.post("/clip/{model_id}/download", status_code=202)
async def download_clip_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in CLIP_MODELS:
        raise HTTPException(404, "Unknown CLIP model")
    if is_clip_downloaded(model_id):
        raise HTTPException(409, "Model already downloaded")

    running = db.query(Job).filter(
        Job.type == JobType.MODEL_DOWNLOAD,
        Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if running:
        raise HTTPException(409, "A model download is already in progress")

    job = Job(type=JobType.MODEL_DOWNLOAD, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.model_manager import download_clip
    from app.queue import enqueue
    await enqueue(job.id, download_clip, model_id, job.id)
    return {"job_id": job.id}


@router.post("/nudenet/{model_id}/download", status_code=202)
async def download_nudenet_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in NUDENET_MODELS:
        raise HTTPException(404, "Unknown NudeNet model")
    if is_nudenet_downloaded(model_id):
        raise HTTPException(409, "Model already downloaded")

    running = db.query(Job).filter(
        Job.type == JobType.MODEL_DOWNLOAD,
        Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if running:
        raise HTTPException(409, "A model download is already in progress")

    job = Job(type=JobType.MODEL_DOWNLOAD, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.model_manager import download_nudenet
    from app.queue import enqueue
    await enqueue(job.id, download_nudenet, model_id, job.id)
    return {"job_id": job.id}


@router.delete("/clip/{model_id}", status_code=204)
def delete_clip_model(model_id: str, db: Session = Depends(get_db)):
    if model_id not in CLIP_MODELS:
        raise HTTPException(404, "Unknown CLIP model")
    active = get_setting(db, _CLIP_SETTING, _CLIP_DEFAULT)
    if model_id == active:
        raise HTTPException(409, "Cannot delete the active model — switch to another first")
    if not is_clip_downloaded(model_id):
        raise HTTPException(404, "Model not downloaded")
    try:
        delete_clip(model_id)
    except OSError as e:
        raise HTTPException(500, f"Failed to delete model: {e}")


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
