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
    """Base of the Prune path/delete refusals. The message is user-facing; the HTTP
    status for each subclass lives in one table in ``api/prune.py`` (B1/B3)."""


class InvalidPath(SandboxError):
    """Malformed or refused path: NUL byte, hidden entry, symlink, the root, a non-folder."""


class OutsideRoot(SandboxError):
    """The path resolves outside the saved root."""


class PathNotFound(SandboxError):
    """The path does not exist."""


class FolderNotEmpty(SandboxError):
    """``only_if_empty`` delete of a folder that gained an entry."""


class DeleteFailed(SandboxError):
    """The filesystem refused a folder delete."""


def _realpath(path: str) -> str:
    try:
        return os.path.realpath(path)
    except ValueError as e:  # NUL byte
        raise InvalidPath("Invalid path") from e


def validate_root(path: str) -> str:
    """Return the realpath of ``path`` if it is a usable root directory."""
    real = _realpath(path)
    if real == os.sep:
        raise InvalidPath("The filesystem root cannot be used as a root folder")
    if not os.path.isdir(real):
        raise InvalidPath("Root folder does not exist or is not a directory")
    return real


def resolve_inside(root: str, path: str) -> str:
    """Return the realpath of ``path`` if it is ``root`` or inside it.

    ``OutsideRoot`` when it escapes the root, ``PathNotFound`` when it does not
    exist, ``InvalidPath`` for a NUL byte or when any path component below the
    root (as written or as resolved) is hidden. Callers decide whether the root
    itself is acceptable.
    """
    root_real = _realpath(root)
    real = _realpath(path)
    try:
        inside = os.path.commonpath([real, root_real]) == root_real
    except ValueError:
        inside = False
    if not inside:
        raise OutsideRoot("Path is outside the root folder")
    if not os.path.lexists(real):
        raise PathNotFound("Path does not exist")
    if _has_hidden_component(root_real, real) or _has_hidden_component(
        root_real, os.path.normpath(path)
    ):
        raise InvalidPath("Hidden entries are not managed here")
    return real


def _has_hidden_component(root: str, path: str) -> bool:
    rel = os.path.relpath(path, root)
    if rel == "." or rel == os.pardir or rel.startswith(os.pardir + os.sep):
        return False  # the root itself, or a spelling outside it (realpath decides)
    return any(is_hidden(part) for part in rel.split(os.sep))


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
