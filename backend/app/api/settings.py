from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])

_CONCURRENT_KEY = "max_concurrent_transcodes"
_CONCURRENT_DEFAULT = "1"


class SettingsRead(BaseModel):
    max_concurrent_transcodes: int


class SettingsUpdate(BaseModel):
    max_concurrent_transcodes: int = Field(ge=1, le=8)


@router.get("", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    return SettingsRead(
        max_concurrent_transcodes=int(get_setting(db, _CONCURRENT_KEY, _CONCURRENT_DEFAULT)),
    )


@router.patch("", response_model=SettingsRead)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    from app.queue import update_max_concurrent
    set_setting(db, _CONCURRENT_KEY, str(body.max_concurrent_transcodes))
    update_max_concurrent(body.max_concurrent_transcodes)
    return SettingsRead(max_concurrent_transcodes=body.max_concurrent_transcodes)
