from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])

_CONCURRENT_KEY = "max_concurrent_transcodes"
_CONCURRENT_DEFAULT = "1"
_TMDB_KEY = "tmdb_api_key"


class SettingsRead(BaseModel):
    max_concurrent_transcodes: int
    tmdb_api_key: str


class SettingsUpdate(BaseModel):
    max_concurrent_transcodes: int = Field(ge=1, le=8)
    tmdb_api_key: str = Field(default="", max_length=128)


@router.get("", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    return SettingsRead(
        max_concurrent_transcodes=int(get_setting(db, _CONCURRENT_KEY, _CONCURRENT_DEFAULT)),
        tmdb_api_key=get_setting(db, _TMDB_KEY, ""),
    )


@router.patch("", response_model=SettingsRead)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    from app.queue import update_max_concurrent
    set_setting(db, _CONCURRENT_KEY, str(body.max_concurrent_transcodes))
    update_max_concurrent(body.max_concurrent_transcodes)
    set_setting(db, _TMDB_KEY, body.tmdb_api_key)
    return SettingsRead(
        max_concurrent_transcodes=body.max_concurrent_transcodes,
        tmdb_api_key=body.tmdb_api_key,
    )
