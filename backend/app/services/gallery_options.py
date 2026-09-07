import json

from app.models.settings import get_setting, set_setting
from app.schemas import GalleryOptions

OPTIONS_KEY = "gallery_options"


def load_options(db) -> GalleryOptions:
    raw = get_setting(db, OPTIONS_KEY, "")
    if not raw:
        return GalleryOptions()
    try:
        return GalleryOptions.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValueError):
        return GalleryOptions()


def save_options(db, opts: GalleryOptions) -> None:
    set_setting(db, OPTIONS_KEY, opts.model_dump_json())
