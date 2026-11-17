"""A short-lived cache of raw candidate downloads, so a season pack is fetched once.

A show's episodes often come from one archive: the preview, the length check and the save of
episode after episode would each download it again. The raw bytes (exactly as the source sent
them, capped by the provider) are kept in `DATA_DIR/subtitle-downloads/` keyed by source and id,
and swept after an hour, at startup and before each new entry, like the previews. Not tied to
any job. Nothing here can fail a download: a cache that cannot be read or written is a miss.
"""

import hashlib
import logging
import os
import re
import threading
import time

from app.config import DATA_DIR

logger = logging.getLogger(__name__)

DOWNLOADS_DIR = os.path.join(DATA_DIR, "subtitle-downloads")
MAX_AGE_SECONDS = 3600


def _path(provider: str, subtitle_id: str) -> str:
    """A file name made only of a plain source name and a hash, so no id can leave the folder."""
    source = re.sub(r"[^a-z0-9]", "", provider.lower())[:32] or "x"
    digest = hashlib.sha1(subtitle_id.encode("utf-8", "replace")).hexdigest()
    return os.path.join(DOWNLOADS_DIR, f"{source}-{digest}.bin")


def get(provider: str, subtitle_id: str) -> bytes | None:
    try:
        with open(_path(provider, subtitle_id), "rb") as f:
            return f.read()
    except OSError:
        return None


def put(provider: str, subtitle_id: str, raw: bytes) -> None:
    """Keep `raw`: written to a temp file then renamed, so a crash never leaves half a file."""
    if not raw:
        return
    path = _path(provider, subtitle_id)
    tmp = f"{path}.{os.getpid()}-{threading.get_ident()}.tmp"
    try:
        sweep()
        os.makedirs(DOWNLOADS_DIR, exist_ok=True)
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, path)
    except OSError as exc:
        logger.warning("could not cache a subtitle download: %s", exc)
        try:
            os.remove(tmp)
        except OSError:
            pass


def sweep(max_age: float = MAX_AGE_SECONDS) -> int:
    """Delete cached downloads (and stray temp files) older than `max_age` seconds."""
    removed = 0
    try:
        names = os.listdir(DOWNLOADS_DIR)
    except OSError:
        return 0
    cutoff = time.time() - max_age
    for name in names:
        path = os.path.join(DOWNLOADS_DIR, name)
        try:
            if (
                os.path.isfile(path)
                and not os.path.islink(path)
                and os.path.getmtime(path) <= cutoff
            ):
                os.remove(path)
                removed += 1
        except OSError:
            continue
    return removed


def fetch_cached(provider_obj, provider: str, subtitle_id: str) -> bytes:
    """The raw download for a candidate: from the cache, else fetched and kept."""
    raw = get(provider, subtitle_id)
    if raw is None:
        raw = provider_obj.fetch(subtitle_id)
        put(provider, subtitle_id, raw)
    return raw
