"""Shared image quarantine/forget mechanics.

Used by the Images API (quarantine / delete) and by image Upscale's "replace originals", so the
file move and the row bookkeeping live in one place. Callers own the DB commit and any stats.
"""

import os
import shutil

from sqlalchemy.orm import Session

from app.models.image import ImageDetection, ImageFile, ImageStatus
from app.services import image_scanner


def _free_name(directory: str, filename: str, image_id: int) -> str:
    """`filename`, or `<stem>_<id>[_<n>]<ext>` when something already sits at that name."""
    stem, ext = os.path.splitext(filename)
    candidate, n = filename, 0
    while os.path.exists(os.path.join(directory, candidate)):
        candidate = f"{stem}_{image_id}{'' if n == 0 else f'_{n}'}{ext}"
        n += 1
    return candidate


def move_to_quarantine(f: ImageFile) -> str:
    """Move the file into `<its folder>/_quarantine/` and mark the row quarantined.

    Never overwrites a file already quarantined under the same name (the row keeps its original
    `filename`, which is what Restore puts it back under). No commit.
    """
    q_dir = os.path.join(os.path.dirname(f.path), "_quarantine")
    os.makedirs(q_dir, exist_ok=True)
    dest = os.path.join(q_dir, _free_name(q_dir, os.path.basename(f.path), f.id))
    shutil.move(f.path, dest)
    f.path = dest
    f.status = ImageStatus.QUARANTINED
    return dest


def forget_image_row(db: Session, f: ImageFile) -> None:
    """Drop an image's row, detections and thumbnail (not the file itself). No commit."""
    thumb = os.path.join(image_scanner.THUMBNAIL_DIR, f"{f.id}.jpg")
    if os.path.exists(thumb):
        os.remove(thumb)
    db.query(ImageDetection).filter(ImageDetection.image_id == f.id).delete()
    db.delete(f)
