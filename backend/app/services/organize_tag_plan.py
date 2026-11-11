"""Which writer a file gets for Organize's tag editing, and which tag names can be edited.

Pure planning, no writes. The writers live in ``organize_tag_writers`` and the apply flow
in ``organize_tag_write``. Callers must have sandboxed ``path`` already. Blocking: call via
a threadpool.

Writer families, by extension (never by guessing):

* ``mkv`` (mkv, webm): ``mkvpropedit`` in place, global tags only.
* ``id3`` / ``vorbis`` / ``mp4``: mutagen on a hidden temp copy that replaces the file.
* ``ffmpeg``: a stream-copy rewrite, only for the few video containers nothing else handles.
* ``image``: exiftool, for the extensions it reports as writable.
"""

import functools
import logging
import os
import re
import stat
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Literal

from app.services import organize_tags
from app.services.organize_sandbox import kind_of

logger = logging.getLogger(__name__)

Tier = Literal["in_place", "rewrite"]
Family = Literal["mkv", "id3", "vorbis", "mp4", "ffmpeg", "image"]

MEDIA_FIELDS: tuple[str, ...] = (
    "title",
    "description",
    "synopsis",
    "comment",
    "artist",
    "album",
    "album_artist",
    "genre",
    "date",
    "track",
)
IMAGE_FIELDS: tuple[str, ...] = (
    "title",
    "description",
    "artist",
    "copyright",
    "keywords",
    "date",
    "gps",
)

RAW_PREFIX = "raw:"
MAX_RAW_NAME = 100

_FAMILY_BY_EXT: dict[str, Family] = {
    **dict.fromkeys((".mkv", ".webm"), "mkv"),
    ".mp3": "id3",
    **dict.fromkeys((".flac", ".ogg", ".oga", ".opus"), "vorbis"),
    **dict.fromkeys((".mp4", ".m4v", ".m4a", ".m4b", ".mov", ".3gp"), "mp4"),
    **dict.fromkeys(
        (".avi", ".ts", ".m2ts", ".mts", ".flv", ".wmv", ".asf", ".mpg", ".mpeg", ".ogv")
        + (".wav", ".aif", ".aiff", ".wma"),
        "ffmpeg",
    ),
}

FFMPEG_NOTE = "Other tags in this format may not survive the rewrite."

# Canonical field -> the container's own tag. Each row is confirmed by a round trip through
# ffprobe in the writer tests; a wrong row fails there, not here.
MKV_NAMES: dict[str, str] = {
    "description": "DESCRIPTION",
    "synopsis": "SYNOPSIS",
    "comment": "COMMENT",
    "artist": "ARTIST",
    "album": "ALBUM",
    "album_artist": "ALBUM_ARTIST",
    "genre": "GENRE",
    "date": "DATE",
    "track": "TRACK",
}  # "title" is the segment title, not a tag
ID3_FRAMES: dict[str, str] = {
    "title": "TIT2",
    "artist": "TPE1",
    "album": "TALB",
    "album_artist": "TPE2",
    "genre": "TCON",
    "date": "TDRC",
    "track": "TRCK",
    "comment": "COMM",
    "description": "TXXX:DESCRIPTION",
    "synopsis": "TXXX:SYNOPSIS",
}
VORBIS_NAMES: dict[str, str] = {
    "title": "TITLE",
    "artist": "ARTIST",
    "album": "ALBUM",
    "album_artist": "ALBUMARTIST",
    "genre": "GENRE",
    "date": "DATE",
    "track": "TRACKNUMBER",
    "comment": "COMMENT",
    "description": "DESCRIPTION",
    "synopsis": "SYNOPSIS",
}
MP4_ATOMS: dict[str, str] = {
    "title": "\xa9nam",
    "artist": "\xa9ART",
    "album": "\xa9alb",
    "album_artist": "aART",
    "genre": "\xa9gen",
    "date": "\xa9day",
    "track": "trkn",
    "comment": "\xa9cmt",
    "description": "desc",
    "synopsis": "ldes",
}
# Names ffprobe shows for frames/atoms that are real tags of their own, not custom ones.
# Editing "composer" must write TCOM, never a second TXXX:composer next to it.
ID3_EXTRA: dict[str, str] = {
    "composer": "TCOM",
    "publisher": "TPUB",
    "copyright": "TCOP",
    "disc": "TPOS",
    "bpm": "TBPM",
    "language": "TLAN",
}
MP4_EXTRA: dict[str, str] = {
    "composer": "\xa9wrt",
    "copyright": "cprt",
    "grouping": "\xa9grp",
    "lyrics": "\xa9lyr",
    "encoder": "\xa9too",
}
MP4_FREEFORM_MEAN = "com.apple.iTunes"

# Lower-case name a reader may show -> canonical field it belongs to.
CANONICAL_ALIASES: dict[str, str] = {
    **{
        alias: field for field, aliases in organize_tags._MEDIA_ALIASES.items() for alias in aliases
    },
    **{field: field for field in MEDIA_FIELDS},
}

# Image tag groups the reader shows and the writer may touch. File:, System:, Composite:
# and the like (rename, permissions, computed values) are never writable.
IMAGE_RAW_NAME = re.compile(r"^(?:IFD0|ExifIFD|GPS|IPTC|XMP[A-Za-z0-9-]*):[A-Za-z0-9_-]{1,64}$")
_IMAGE_CANONICAL_SOURCES = frozenset(
    name for aliases in organize_tags._IMAGE_ALIASES.values() for name in aliases
)


def label_of(field: str) -> str:
    return field.replace("_", " ").capitalize()


@dataclass(frozen=True)
class WritePlan:
    writable: bool
    how: Tier | None
    reason: str | None
    fields: list[str]
    bytes_needed: int
    note: str | None
    can_add_raw: bool


def _refused(reason: str) -> WritePlan:
    return WritePlan(False, None, reason, [], 0, None, False)


@functools.lru_cache(maxsize=1)
def _exiftool_writable() -> frozenset[str]:
    """Extensions (dotted, lower-case) exiftool can write, asked once per process."""
    try:
        done = subprocess.run(
            ["exiftool", "-listwf"], capture_output=True, text=True, timeout=20, check=False
        )
    except (OSError, subprocess.SubprocessError):
        logger.warning("exiftool could not list its writable types")
        return frozenset()
    words = done.stdout.split(":", 1)[-1].split()
    return frozenset("." + w.lower() for w in words)


def family_of(path: str) -> Family | None:
    """The writer family for a path's extension, or None when nothing can write it."""
    ext = os.path.splitext(path)[1].lower()
    if kind_of(os.path.basename(path)) == "image":
        return "image" if ext in _exiftool_writable() else None
    return _FAMILY_BY_EXT.get(ext)


def validate_raw_name(path: str, name: str) -> str | None:
    """An error message when ``name`` (without the ``raw:`` prefix) may not be written as a
    free tag name in this file, else None."""
    if not name or len(name) > MAX_RAW_NAME:
        return f"A tag name must be 1 to {MAX_RAW_NAME} characters."
    if any(ord(c) < 32 or ord(c) == 127 for c in name):
        return "A tag name can't contain line breaks or control characters."
    family = family_of(path)
    if family == "image":
        if not IMAGE_RAW_NAME.match(name):
            return "Use a name like XMP-dc:Source or IFD0:Make (EXIF, IPTC, XMP and GPS tags only)."
        return None
    field = CANONICAL_ALIASES.get(name.lower())
    if field is not None:
        return f"{label_of(field)} is a standard field: use the {label_of(field)} field instead."
    if family == "vorbis" and ("=" in name or any(not 0x20 <= ord(c) <= 0x7D for c in name)):
        return "A Vorbis tag name must be plain ASCII and can't contain =."
    if family == "ffmpeg" and "=" in name:
        return "A tag name can't contain =."
    return None


MKV_UID_TARGETS = ("TrackUID", "EditionUID", "ChapterUID", "AttachmentUID")


def is_global_tag(tag: ET.Element) -> bool:
    """A Matroska ``<Tag>`` that applies to the whole file (no track, chapter, edition or
    attachment target): the only ones Organize ever edits."""
    return not any(tag.find(f"Targets/{uid}") is not None for uid in MKV_UID_TARGETS)


def mkv_tags_root(path: str) -> ET.Element | None:
    """The file's tags as ``mkvextract`` prints them, parsed from bytes (the output starts
    with a byte-order mark), or None when the file has none. Raises OSError,
    SubprocessError or ParseError; callers decide what a failure means."""
    done = subprocess.run(
        ["mkvextract", "tags", path], capture_output=True, timeout=30, check=False
    )
    return ET.fromstring(done.stdout) if done.stdout.strip() else None


def _mkv_global_names(path: str) -> list[str]:
    root = mkv_tags_root(path)
    if root is None:
        return []
    names: list[str] = []
    for tag in root.findall("Tag"):
        if not is_global_tag(tag):
            continue  # per-track tags are never touched
        for simple in tag.findall("Simple"):
            name = (simple.findtext("Name") or "").strip()
            if name and name.lower() not in CANONICAL_ALIASES and name not in names:
                names.append(name)
    return names


def _id3_names(path: str) -> list[str]:
    from mutagen.id3 import ID3, ID3NoHeaderError

    try:
        tags = ID3(path)
    except (ID3NoHeaderError, OSError):
        return []
    by_frame = {frame: name for name, frame in ID3_EXTRA.items()}
    names: list[str] = []
    for frame in tags.values():
        name = None
        if frame.FrameID == "TXXX":
            desc = frame.desc
            if desc.lower() not in CANONICAL_ALIASES:
                name = desc
        elif frame.FrameID in by_frame:
            name = by_frame[frame.FrameID]
        if name and name not in names:
            names.append(name)
    return names


def _vorbis_names(path: str) -> list[str]:
    import mutagen

    try:
        audio = mutagen.File(path)
    except Exception:
        return []
    names: list[str] = []
    for key in (audio.tags or {}).keys():  # noqa: SIM118 - mutagen tag containers, not dicts
        if key.lower() not in CANONICAL_ALIASES and key not in names:
            names.append(key)
    return names


def _mp4_names(path: str) -> list[str]:
    from mutagen.mp4 import MP4

    try:
        tags = MP4(path).tags
    except Exception:
        return []
    by_atom = {atom: name for name, atom in MP4_EXTRA.items()}
    prefix = f"----:{MP4_FREEFORM_MEAN}:"
    names: list[str] = []
    for key in (tags or {}).keys():  # noqa: SIM118
        name = None
        if key.startswith(prefix):
            name = key[len(prefix) :]
            if name.lower() in CANONICAL_ALIASES:
                name = None
        elif key in by_atom:
            name = by_atom[key]
        if name and name not in names:
            names.append(name)
    return names


def _read_raw(path: str) -> dict[str, str]:
    info = organize_tags.read_tags(path, full=True)
    return info["raw"] if info else {}


def _ffmpeg_names(path: str) -> list[str]:
    return [k for k in _read_raw(path) if k.lower() not in CANONICAL_ALIASES]


def _image_names(path: str) -> list[str]:
    return [
        k for k in _read_raw(path) if k not in _IMAGE_CANONICAL_SOURCES and IMAGE_RAW_NAME.match(k)
    ]


_RAW_LISTERS = {
    "mkv": _mkv_global_names,
    "id3": _id3_names,
    "vorbis": _vorbis_names,
    "mp4": _mp4_names,
    "ffmpeg": _ffmpeg_names,
    "image": _image_names,
}


def raw_names(path: str, family: Family) -> list[str]:
    """Free tag names already on the file that can be edited or cleared, as the writer for
    its family addresses them. Never raises."""
    try:
        return _RAW_LISTERS[family](path)
    except Exception:  # a tool or library failing must not hide the plan
        logger.warning("could not list the tag names of a file")
        return []


def plan_one(path: str) -> WritePlan:
    """Whether ``path`` can be written, how, why not, and the free space a rewrite needs."""
    kind = organize_tags._eligible(path.rstrip(os.sep) or path)
    if kind is None:
        return _refused(
            "This file can't be edited: it is missing, hidden, a link or not a media file."
        )
    family = family_of(path)
    if family is None:
        if kind == "image":
            ext = os.path.splitext(path)[1].lstrip(".").upper()
            return _refused(f"Parallax can't write tags into {ext} files.")
        return _refused("Parallax can't edit tags in this format.")
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode):
        return _refused("This file can't be edited: it is not a regular file.")
    in_place = family == "mkv"
    if not in_place and st.st_nlink > 1:
        return _refused(
            "This file has other hard links; rewriting it would break them, so it is not edited."
        )
    base = IMAGE_FIELDS if family == "image" else MEDIA_FIELDS
    fields = [*base, *(RAW_PREFIX + n for n in raw_names(path, family))]
    return WritePlan(
        writable=True,
        how="in_place" if in_place else "rewrite",
        reason=None,
        fields=fields,
        bytes_needed=0 if in_place else st.st_size,
        note=FFMPEG_NOTE if family == "ffmpeg" else None,
        can_add_raw=True,
    )


__all__ = [
    "CANONICAL_ALIASES",
    "FFMPEG_NOTE",
    "IMAGE_FIELDS",
    "MEDIA_FIELDS",
    "WritePlan",
    "family_of",
    "plan_one",
    "raw_names",
    "validate_raw_name",
]
