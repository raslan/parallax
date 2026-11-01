"""Path sandbox and media-kind classification for the Prune page.

Every Prune endpoint resolves user-supplied paths through ``resolve_inside``
so nothing outside the saved root (via ``..``, symlinks, or a sibling with a
shared name prefix) can be touched.
"""

import os
from typing import Literal

from app.services.audio_scanner import AUDIO_EXTENSIONS
from app.services.image_scanner import SUPPORTED_EXTENSIONS as IMAGE_EXTENSIONS
from app.services.scanner import VIDEO_EXTENSIONS

Kind = Literal["image", "video", "audio", "other"]


class SandboxError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def validate_root(path: str) -> str:
    """Return the realpath of ``path`` if it is a usable root directory."""
    real = os.path.realpath(path)
    if real == os.sep:
        raise SandboxError(400, "The filesystem root cannot be used as a root folder")
    if not os.path.isdir(real):
        raise SandboxError(400, "Root folder does not exist or is not a directory")
    return real


def resolve_inside(root: str, path: str) -> str:
    """Return the realpath of ``path`` if it is ``root`` or inside it.

    403 when it escapes the root, 404 when it does not exist. Callers decide
    whether the root itself is acceptable.
    """
    root_real = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        inside = os.path.commonpath([real, root_real]) == root_real
    except ValueError:
        inside = False
    if not inside:
        raise SandboxError(403, "Path is outside the root folder")
    if not os.path.lexists(real):
        raise SandboxError(404, "Path does not exist")
    return real


def kind_of(name: str) -> Kind:
    ext = os.path.splitext(name)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    return "other"


def is_hidden(name: str) -> bool:
    return name.startswith(".")
