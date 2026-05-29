from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting
from app.queue import update_max_concurrent
from app.services.image_analyzer import release_sessions
from app.services.model_manager import CLIP_MODELS, NUDENET_MODELS, is_clip_downloaded, is_nudenet_downloaded

router = APIRouter(prefix="/settings", tags=["settings"])

_CONCURRENT_KEY = "max_concurrent_transcodes"
_CONCURRENT_DEFAULT = "1"
_TMDB_KEY = "tmdb_api_key"
_CLIP_MODEL_KEY = "clip_model"
_CLIP_MODEL_DEFAULT = "clip-vit-base-patch32"
_NUDENET_MODEL_KEY = "nudenet_model"
_NUDENET_MODEL_DEFAULT = "320n"
_VIDEO_KEYFRAMES_KEY = "video_keyframes_per_video"
_VIDEO_KEYFRAMES_DEFAULT = "8"
_BATCH_SIZE_KEY = "scan_batch_size"
_BATCH_SIZE_DEFAULT = "4"
_OS_API_KEY = "opensubtitles_api_key"
_SUBTITLE_LANGUAGES_KEY = "subtitle_languages"
_SUBTITLE_LANGUAGES_DEFAULT = "en"


class SettingsRead(BaseModel):
    max_concurrent_transcodes: int
    tmdb_api_key: str
    clip_model: str
    nudenet_model: str
    video_keyframes_per_video: int
    scan_batch_size: int
    opensubtitles_api_key: str
    subtitle_languages: str


class SettingsUpdate(BaseModel):
    max_concurrent_transcodes: Optional[int] = Field(default=None, ge=1, le=8)
    tmdb_api_key: Optional[str] = Field(default=None, max_length=128)
    clip_model: Optional[str] = None
    nudenet_model: Optional[str] = None
    video_keyframes_per_video: Optional[int] = Field(default=None, ge=1, le=50)
    scan_batch_size: Optional[int] = Field(default=None, ge=1, le=32)
    opensubtitles_api_key: Optional[str] = Field(default=None, max_length=128)
    subtitle_languages: Optional[str] = Field(default=None, max_length=64)


def _read_settings(db: Session) -> SettingsRead:
    return SettingsRead(
        max_concurrent_transcodes=int(get_setting(db, _CONCURRENT_KEY, _CONCURRENT_DEFAULT)),
        tmdb_api_key=get_setting(db, _TMDB_KEY, ""),
        clip_model=get_setting(db, _CLIP_MODEL_KEY, _CLIP_MODEL_DEFAULT),
        nudenet_model=get_setting(db, _NUDENET_MODEL_KEY, _NUDENET_MODEL_DEFAULT),
        video_keyframes_per_video=int(get_setting(db, _VIDEO_KEYFRAMES_KEY, _VIDEO_KEYFRAMES_DEFAULT)),
        scan_batch_size=int(get_setting(db, _BATCH_SIZE_KEY, _BATCH_SIZE_DEFAULT)),
        opensubtitles_api_key=get_setting(db, _OS_API_KEY, ""),
        subtitle_languages=get_setting(db, _SUBTITLE_LANGUAGES_KEY, _SUBTITLE_LANGUAGES_DEFAULT),
    )


@router.get("", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    return _read_settings(db)


@router.patch("", response_model=SettingsRead)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    model_changed = False

    if body.clip_model is not None:
        if body.clip_model not in CLIP_MODELS:
            raise HTTPException(400, f"Unknown CLIP model: {body.clip_model}")
        if not is_clip_downloaded(body.clip_model):
            raise HTTPException(422, f"CLIP model '{body.clip_model}' is not downloaded yet")
        set_setting(db, _CLIP_MODEL_KEY, body.clip_model)
        model_changed = True

    if body.nudenet_model is not None:
        if body.nudenet_model not in NUDENET_MODELS:
            raise HTTPException(400, f"Unknown NudeNet model: {body.nudenet_model}")
        if not is_nudenet_downloaded(body.nudenet_model):
            raise HTTPException(422, f"NudeNet model '{body.nudenet_model}' is not downloaded yet")
        set_setting(db, _NUDENET_MODEL_KEY, body.nudenet_model)
        model_changed = True

    if body.max_concurrent_transcodes is not None:
        set_setting(db, _CONCURRENT_KEY, str(body.max_concurrent_transcodes))
        try:
            update_max_concurrent(body.max_concurrent_transcodes)
        except Exception:
            pass

    if body.tmdb_api_key is not None:
        set_setting(db, _TMDB_KEY, body.tmdb_api_key)

    if body.video_keyframes_per_video is not None:
        set_setting(db, _VIDEO_KEYFRAMES_KEY, str(body.video_keyframes_per_video))

    if body.scan_batch_size is not None:
        set_setting(db, _BATCH_SIZE_KEY, str(body.scan_batch_size))

    if body.opensubtitles_api_key is not None:
        set_setting(db, _OS_API_KEY, body.opensubtitles_api_key)

    if body.subtitle_languages is not None:
        set_setting(db, _SUBTITLE_LANGUAGES_KEY, body.subtitle_languages)

    if model_changed:
        release_sessions()

    return _read_settings(db)
