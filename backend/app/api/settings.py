from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])

_CONCURRENT_KEY = "max_concurrent_transcodes"
_CONCURRENT_DEFAULT = "1"
_TMDB_KEY = "tmdb_api_key"
_CLIP_MODEL_KEY = "clip_model"
_CLIP_MODEL_DEFAULT = "clip-vit-base-patch32"
_NUDENET_MODEL_KEY = "nudenet_model"
_NUDENET_MODEL_DEFAULT = "320n"


class SettingsRead(BaseModel):
    max_concurrent_transcodes: int
    tmdb_api_key: str
    clip_model: str
    nudenet_model: str


class SettingsUpdate(BaseModel):
    max_concurrent_transcodes: int = Field(ge=1, le=8)
    tmdb_api_key: str = Field(default="", max_length=128)
    clip_model: str = Field(default=_CLIP_MODEL_DEFAULT)
    nudenet_model: str = Field(default=_NUDENET_MODEL_DEFAULT)


def _read_settings(db: Session) -> SettingsRead:
    return SettingsRead(
        max_concurrent_transcodes=int(get_setting(db, _CONCURRENT_KEY, _CONCURRENT_DEFAULT)),
        tmdb_api_key=get_setting(db, _TMDB_KEY, ""),
        clip_model=get_setting(db, _CLIP_MODEL_KEY, _CLIP_MODEL_DEFAULT),
        nudenet_model=get_setting(db, _NUDENET_MODEL_KEY, _NUDENET_MODEL_DEFAULT),
    )


@router.get("", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    return _read_settings(db)


@router.patch("", response_model=SettingsRead)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    from app.services.model_manager import CLIP_MODELS, NUDENET_MODELS, is_clip_downloaded, is_nudenet_downloaded

    if body.clip_model not in CLIP_MODELS:
        raise HTTPException(400, f"Unknown CLIP model: {body.clip_model}")
    if not is_clip_downloaded(body.clip_model):
        raise HTTPException(409, f"CLIP model '{body.clip_model}' is not downloaded yet")
    if body.nudenet_model not in NUDENET_MODELS:
        raise HTTPException(400, f"Unknown NudeNet model: {body.nudenet_model}")
    if not is_nudenet_downloaded(body.nudenet_model):
        raise HTTPException(409, f"NudeNet model '{body.nudenet_model}' is not downloaded yet")

    from app.queue import update_max_concurrent
    set_setting(db, _CONCURRENT_KEY, str(body.max_concurrent_transcodes))
    set_setting(db, _TMDB_KEY, body.tmdb_api_key)
    set_setting(db, _CLIP_MODEL_KEY, body.clip_model)
    set_setting(db, _NUDENET_MODEL_KEY, body.nudenet_model)
    try:
        update_max_concurrent(body.max_concurrent_transcodes)
    except Exception:
        pass

    from app.services.image_analyzer import release_sessions
    release_sessions()

    return _read_settings(db)
