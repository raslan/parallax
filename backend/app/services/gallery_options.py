import json

from app.models.settings import get_setting, set_setting
from app.schemas import GalleryListTypes, GalleryOptions

OPTIONS_KEY = "gallery_options"
LIST_TYPES_KEY = "gallery_list_types"


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


def load_list_types(db) -> dict[str, GalleryListTypes]:
    """`{list name: content-type override}`; a corrupt blob or entry is dropped, not raised."""
    raw = get_setting(db, LIST_TYPES_KEY, "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, GalleryListTypes] = {}
    for name, blob in data.items():
        try:
            out[name] = GalleryListTypes.model_validate(blob)
        except ValueError:
            continue
    return out


def _save_list_types(db, mapping: dict[str, GalleryListTypes]) -> None:
    set_setting(db, LIST_TYPES_KEY, json.dumps({n: t.model_dump() for n, t in mapping.items()}))


def set_list_types(db, name: str, types: GalleryListTypes) -> None:
    mapping = load_list_types(db)
    mapping[name] = types
    _save_list_types(db, mapping)


def clear_list_types(db, name: str) -> None:
    mapping = load_list_types(db)
    if mapping.pop(name, None) is not None:
        _save_list_types(db, mapping)


def rename_list_types(db, old: str, new: str) -> None:
    mapping = load_list_types(db)
    if old in mapping:
        mapping[new] = mapping.pop(old)
        _save_list_types(db, mapping)


def effective_options(db, opts: GalleryOptions, list_name: str) -> GalleryOptions:
    """`opts` with the list's content-type override (if any) swapped in."""
    override = load_list_types(db).get(list_name)
    if override is None:
        return opts
    return opts.model_copy(update=override.model_dump())
