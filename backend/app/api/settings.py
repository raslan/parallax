import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from app.database import DATA_DIR, get_db
from app.models.settings import get_setting, set_setting
from app.queue import update_max_concurrent
from app.services.downloader import set_max_concurrent as set_max_concurrent_downloads
from app.services.image_analyzer import release_sessions
from app.services.model_manager import (
    NUDENET_MODELS,
    WHISPER_MODELS,
    is_nudenet_downloaded,
    is_whisper_downloaded,
)

router = APIRouter(prefix="/settings", tags=["settings"])

_CONCURRENT_KEY = "max_concurrent_transcodes"
_CONCURRENT_DEFAULT = "1"
_TMDB_KEY = "tmdb_api_key"
_NUDENET_MODEL_KEY = "nudenet_model"
_NUDENET_MODEL_DEFAULT = "320n"
_WHISPER_MODEL_KEY = "whisper_model"
_WHISPER_MODEL_DEFAULT = "small"
_VIDEO_KEYFRAMES_KEY = "video_keyframes_per_video"
_VIDEO_KEYFRAMES_DEFAULT = "32"
_BATCH_SIZE_KEY = "scan_batch_size"
_BATCH_SIZE_DEFAULT = "4"
_PREFETCH_KEY = "scan_prefetch"
_PREFETCH_DEFAULT = "4"
_SUBTITLE_LANGUAGES_KEY = "subtitle_languages"
_SUBTITLE_LANGUAGES_DEFAULT = "en"
_DOWNLOAD_DIR_KEY = "download_dir"
_DOWNLOAD_DIR_DEFAULT = "/media/downloads"
_MAX_DOWNLOADS_KEY = "max_concurrent_downloads"
_MAX_DOWNLOADS_DEFAULT = "2"
_YTDLP_CHANNEL_KEY = "ytdlp_channel"
_YTDLP_CHANNEL_DEFAULT = "stable"


class SettingsRead(BaseModel):
    max_concurrent_transcodes: int
    tmdb_api_key: str
    nudenet_model: str
    whisper_model: str
    video_keyframes_per_video: int
    scan_batch_size: int
    scan_prefetch: int
    subtitle_languages: str
    download_dir: str
    max_concurrent_downloads: int
    ytdlp_channel: str
    encoder_family: str
    concurrent_limit_hint: int | None


class SettingsUpdate(BaseModel):
    max_concurrent_transcodes: int | None = Field(default=None, ge=1, le=8)
    tmdb_api_key: str | None = Field(default=None, max_length=128)
    nudenet_model: str | None = None
    whisper_model: str | None = None
    video_keyframes_per_video: int | None = Field(default=None, ge=1, le=512)
    scan_batch_size: int | None = Field(default=None, ge=1, le=32)
    scan_prefetch: int | None = Field(default=None, ge=1, le=20)
    subtitle_languages: str | None = Field(default=None, max_length=64)
    download_dir: str | None = Field(default=None, max_length=512)
    max_concurrent_downloads: int | None = Field(default=None, ge=1, le=5)
    ytdlp_channel: str | None = Field(default=None, pattern="^(stable|nightly)$")


def _read_settings(db: Session) -> SettingsRead:
    from app.services.encoder import get_concurrent_limit_hint, get_encoder_family

    return SettingsRead(
        max_concurrent_transcodes=int(get_setting(db, _CONCURRENT_KEY, _CONCURRENT_DEFAULT)),
        tmdb_api_key=get_setting(db, _TMDB_KEY, ""),
        nudenet_model=get_setting(db, _NUDENET_MODEL_KEY, _NUDENET_MODEL_DEFAULT),
        whisper_model=get_setting(db, _WHISPER_MODEL_KEY, _WHISPER_MODEL_DEFAULT),
        video_keyframes_per_video=int(
            get_setting(db, _VIDEO_KEYFRAMES_KEY, _VIDEO_KEYFRAMES_DEFAULT)
        ),
        scan_batch_size=int(get_setting(db, _BATCH_SIZE_KEY, _BATCH_SIZE_DEFAULT)),
        scan_prefetch=int(get_setting(db, _PREFETCH_KEY, _PREFETCH_DEFAULT)),
        subtitle_languages=get_setting(db, _SUBTITLE_LANGUAGES_KEY, _SUBTITLE_LANGUAGES_DEFAULT),
        download_dir=get_setting(db, _DOWNLOAD_DIR_KEY, _DOWNLOAD_DIR_DEFAULT),
        max_concurrent_downloads=int(get_setting(db, _MAX_DOWNLOADS_KEY, _MAX_DOWNLOADS_DEFAULT)),
        ytdlp_channel=get_setting(db, _YTDLP_CHANNEL_KEY, _YTDLP_CHANNEL_DEFAULT),
        encoder_family=get_encoder_family(),
        concurrent_limit_hint=get_concurrent_limit_hint(),
    )


@router.get("", response_model=SettingsRead)
def get_settings(db: Session = Depends(get_db)):
    return _read_settings(db)


@router.patch("", response_model=SettingsRead)
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    model_changed = False

    if body.nudenet_model is not None:
        if body.nudenet_model not in NUDENET_MODELS:
            raise HTTPException(400, f"Unknown NudeNet model: {body.nudenet_model}")
        if not is_nudenet_downloaded(body.nudenet_model):
            raise HTTPException(422, f"NudeNet model '{body.nudenet_model}' is not downloaded yet")
        set_setting(db, _NUDENET_MODEL_KEY, body.nudenet_model)
        model_changed = True

    if body.whisper_model is not None:
        if body.whisper_model not in WHISPER_MODELS:
            raise HTTPException(400, f"Unknown Whisper model: {body.whisper_model}")
        if not is_whisper_downloaded(body.whisper_model):
            raise HTTPException(422, f"Whisper model '{body.whisper_model}' is not downloaded yet")
        set_setting(db, _WHISPER_MODEL_KEY, body.whisper_model)

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

    if body.scan_prefetch is not None:
        set_setting(db, _PREFETCH_KEY, str(body.scan_prefetch))

    if body.subtitle_languages is not None:
        set_setting(db, _SUBTITLE_LANGUAGES_KEY, body.subtitle_languages)

    if body.download_dir is not None:
        set_setting(db, _DOWNLOAD_DIR_KEY, body.download_dir)

    if body.max_concurrent_downloads is not None:
        set_setting(db, _MAX_DOWNLOADS_KEY, str(body.max_concurrent_downloads))
        set_max_concurrent_downloads(body.max_concurrent_downloads)
    if body.ytdlp_channel is not None:
        set_setting(db, _YTDLP_CHANNEL_KEY, body.ytdlp_channel)

    if model_changed:
        release_sessions()

    return _read_settings(db)


@router.post("/purge-library-data", status_code=204)
def purge_library_data(db: Session = Depends(get_db)):
    """Delete all libraries, files, and derived data. Settings and AI models are preserved."""
    from app.models.file import File
    from app.models.image import ImageDetection, ImageFile
    from app.models.image_library import ImageLibrary
    from app.models.library import Library
    from app.models.schedule import Schedule
    from app.models.video import VideoDetection
    from app.services import fs_watcher

    # Stop all watchers first
    fs_watcher.shutdown()
    fs_watcher.init()

    # Video: delete VideoDetection, thumbnails, files, schedules, libraries
    all_files = db.query(File).all()
    file_ids = [f.id for f in all_files]
    if file_ids:
        db.query(VideoDetection).filter(VideoDetection.file_id.in_(file_ids)).delete(
            synchronize_session=False
        )
    for f in all_files:
        thumb = os.path.join(DATA_DIR, "thumbnails", f"{f.id}.jpg")
        try:
            os.remove(thumb)
        except FileNotFoundError:
            pass
    db.query(File).delete(synchronize_session=False)
    db.query(Schedule).delete(synchronize_session=False)

    # Image: delete ImageDetection, thumbnails, image files, image libraries
    all_images = db.query(ImageFile).all()
    image_ids = [img.id for img in all_images]
    if image_ids:
        db.query(ImageDetection).filter(ImageDetection.image_id.in_(image_ids)).delete(
            synchronize_session=False
        )
    thumb_dir = os.path.join(DATA_DIR, "image-thumbnails")
    for image_id in image_ids:
        try:
            os.remove(os.path.join(thumb_dir, f"{image_id}.jpg"))
        except FileNotFoundError:
            pass
    db.query(ImageFile).delete(synchronize_session=False)
    db.query(ImageLibrary).delete(synchronize_session=False)

    # Delete all downloads
    from app.models.download import Download

    db.query(Download).delete()

    # Null out library_id on job records before deleting libraries (FK)
    db.execute(sa_text("UPDATE jobs SET library_id = NULL WHERE library_id IS NOT NULL"))
    db.query(Library).delete(synchronize_session=False)

    db.commit()
