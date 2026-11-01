"""Get-or-create thumbnail mechanism shared by the video library (``scanner``), the
image library (``image_scanner``) and Prune (``prune_files``).

Each caller keeps its own paths, keying and generator (video's id-keyed jpg with
its stale-file pre-delete, image's temp + ``os.replace``, Prune's sha1 stems); this
module owns only the cache steps and the concurrency caps they share.
"""

import contextlib
import os
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager

# Caps how many thumbnail generations run at once. A grid page renders a screenful
# of cards on mount, each firing its own request, and the post-scan warm-up jobs
# can queue thousands of files at once; without a cap every one spawns ffmpeg /
# a Pillow decode concurrently. Half the cores (not cores-1): leaving only one
# core free still let a big warm-up saturate the host and starve the API/event loop.
THUMBNAIL_GEN_LIMIT = max(1, (os.cpu_count() or 4) // 2)

# One pool for video frames (ffmpeg) and one for image resizes (Pillow), each
# THUMBNAIL_GEN_LIMIT wide. The library pages and the warm-up jobs use them, and
# Prune's thumbnails go through the same pool as their kind.
VIDEO_THUMB_SEMAPHORE = threading.Semaphore(THUMBNAIL_GEN_LIMIT)
IMAGE_THUMB_SEMAPHORE = threading.Semaphore(THUMBNAIL_GEN_LIMIT)


def get_or_create(
    out_path: str,
    generate: Callable[[], bool],
    *,
    semaphore: threading.Semaphore,
    lock: Callable[[], AbstractContextManager] | None = None,
    failed_path: str | None = None,
    on_hit: Callable[[str], None] | None = None,
) -> str | None:
    """Return ``out_path`` if it exists, else generate it once and return it.

    1. ``out_path`` exists -> return it; ``failed_path`` exists -> None (no retry).
       ``on_hit`` is called with whichever of the two was found.
    2. Under ``lock()`` (a factory for the per-key lock, called only on a miss, so
       two requests for the same missing thumbnail don't both run the generator)
       re-check both.
    3. Under ``semaphore`` call ``generate()``; it must leave a complete file at
       ``out_path`` and return True, or return False.
    4. On False write an empty ``failed_path`` marker (when given) and return None;
       without a marker path the next call simply tries again.

    Exceptions from ``generate`` propagate (callers that want "None on error"
    catch inside their generator).
    """
    if os.path.exists(out_path):
        if on_hit:
            on_hit(out_path)
        return out_path
    if failed_path and os.path.exists(failed_path):
        if on_hit:
            on_hit(failed_path)
        return None
    with lock() if lock is not None else contextlib.nullcontext():
        # Another thread may have just finished (or failed) this exact thumbnail.
        if os.path.exists(out_path):
            return out_path
        if failed_path and os.path.exists(failed_path):
            return None
        with semaphore:
            ok = generate()
        if ok:
            return out_path
        if failed_path:
            os.makedirs(os.path.dirname(failed_path), exist_ok=True)
            open(failed_path, "a").close()
        return None
