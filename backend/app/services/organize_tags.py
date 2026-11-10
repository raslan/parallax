"""Embedded tags of a file, for Organize's metadata view (read-only).

Video and audio are read with ffprobe, images with exiftool. Every file comes back as the
same shape: the canonical ``fields`` the page shows in columns and filters, the ``raw`` tags
as stored, a short ``streams`` summary and whether any value was cut to ``VALUE_CAP``.

Callers must have sandboxed ``paths`` already. Blocking: call via a threadpool.
"""

import json
import logging
import os
import stat
import subprocess
from concurrent.futures import ThreadPoolExecutor

from app.services.organize_sandbox import is_hidden, kind_of

logger = logging.getLogger(__name__)

TAG_FIELDS: tuple[str, ...] = (
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
    "copyright",
    "keywords",
)

#: Longest value (in characters) returned in a batch; a longer one is cut and flagged.
VALUE_CAP = 500

_TIMEOUT_S = 20

# ffprobe already maps each container's own names (ID3 TIT2, MP4 ©nam / desc / ldes,
# Vorbis TITLE) to these, so reading only needs the lower-case aliases.
_MEDIA_ALIASES: dict[str, tuple[str, ...]] = {
    "title": ("title",),
    "description": ("description", "desc"),
    "synopsis": ("synopsis",),
    "comment": ("comment",),
    "artist": ("artist",),
    "album": ("album",),
    "album_artist": ("album_artist", "albumartist"),
    "genre": ("genre",),
    "date": ("date",),
    "track": ("track",),
}

# Images: XMP first, then EXIF, then IPTC (first non-empty wins).
_IMAGE_ALIASES: dict[str, tuple[str, ...]] = {
    "title": ("XMP-dc:Title", "IPTC:ObjectName"),
    "description": ("XMP-dc:Description", "IFD0:ImageDescription", "IPTC:Caption-Abstract"),
    "artist": ("XMP-dc:Creator", "IFD0:Artist", "IPTC:By-line"),
    "copyright": ("XMP-dc:Rights", "IFD0:Copyright", "IPTC:CopyrightNotice"),
    "keywords": ("XMP-dc:Subject", "IPTC:Keywords"),
    "date": ("ExifIFD:DateTimeOriginal", "XMP-photoshop:DateCreated"),
}

# Container boilerplate that says nothing about the content.
_MEDIA_RAW_SKIP = frozenset({"major_brand", "minor_version", "compatible_brands"})
_IMAGE_RAW_GROUPS = ("IFD0:", "ExifIFD:", "GPS:", "IPTC:", "XMP")

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="organize-tags")


def _cap(value: str, full: bool) -> tuple[str, bool]:
    if full or len(value) <= VALUE_CAP:
        return value, False
    return value[:VALUE_CAP] + "…", True


def fields_from_tags(
    tags: dict[str, str], full: bool = False
) -> tuple[dict[str, str], dict[str, str], bool]:
    """``(fields, raw, truncated)`` from a container's tag dict (ffprobe's ``format.tags``).

    Blank values read as absent; a tag stored under two spellings (``DESCRIPTION`` and
    ``description``) is one tag, the first spelling winning.
    """
    truncated = False
    raw: dict[str, str] = {}
    by_lower: dict[str, str] = {}
    for key, value in tags.items():
        lower = key.lower()
        text = str(value).strip()
        if lower in _MEDIA_RAW_SKIP or not text or lower in by_lower:
            continue
        text, cut = _cap(text, full)
        truncated = truncated or cut
        by_lower[lower] = text
        raw[key] = text
    fields: dict[str, str] = {}
    for name, aliases in _MEDIA_ALIASES.items():
        for alias in aliases:
            if alias in by_lower:
                fields[name] = by_lower[alias]
                break
    return fields, raw, truncated


def _image_text(value: object) -> str:
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip()


def fields_from_exiftool(
    entry: dict, full: bool = False
) -> tuple[dict[str, str], dict[str, str], bool]:
    """``(fields, raw, truncated)`` from one ``exiftool -j -G1`` entry."""
    truncated = False
    raw: dict[str, str] = {}
    for key, value in entry.items():
        if not key.startswith(_IMAGE_RAW_GROUPS):
            continue
        text = _image_text(value)
        if not text:
            continue
        text, cut = _cap(text, full)
        truncated = truncated or cut
        raw[key] = text
    fields: dict[str, str] = {}
    for name, aliases in _IMAGE_ALIASES.items():
        for alias in aliases:
            if alias in raw:
                fields[name] = raw[alias]
                break
    return fields, raw, truncated


def _arg(path: str) -> str:
    """A path safe to hand to a tool as an argument (never read as an option)."""
    return path if path.startswith("/") else f"./{path}"


def _run(cmd: list[str]) -> str | None:
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=_TIMEOUT_S, check=False)
    except (OSError, subprocess.SubprocessError):
        logger.warning("%s could not run", cmd[0])
        return None
    # exiftool exits 1 for a warning it still printed JSON for; only no output is failure.
    return done.stdout if done.stdout.strip() else None


def _stream_line(stream: dict) -> str:
    kind = stream.get("codec_type", "?")
    line = f"{kind} {stream.get('codec_name', '?')}"
    if kind == "video" and stream.get("width") and stream.get("height"):
        line += f" {stream['width']}×{stream['height']}"
    if kind == "audio":
        if stream.get("channels"):
            line += f" {stream['channels']}ch"
        if stream.get("sample_rate"):
            line += f" {stream['sample_rate']} Hz"
    return line


def _read_media(path: str, full: bool) -> dict | None:
    out = _run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-i",
            _arg(path),
        ]
    )
    if out is None:
        return None
    try:
        probe = json.loads(out)
    except ValueError:
        return None
    tags = (probe.get("format") or {}).get("tags") or {}
    fields, raw, truncated = fields_from_tags(tags, full)
    streams = [_stream_line(s) for s in probe.get("streams") or []]
    return {"fields": fields, "raw": raw, "streams": streams, "truncated": truncated}


def _read_image(path: str, full: bool) -> dict | None:
    out = _run(["exiftool", "-j", "-G1", "-a", "--", _arg(path)])
    if out is None:
        return None
    try:
        entry = json.loads(out)[0]
    except (ValueError, IndexError, TypeError):
        return None
    fields, raw, truncated = fields_from_exiftool(entry, full)
    width, height = entry.get("File:ImageWidth"), entry.get("File:ImageHeight")
    fmt = str(entry.get("File:FileType", "image")).lower()
    streams = [f"image {fmt} {width}×{height}" if width and height else f"image {fmt}"]
    return {"fields": fields, "raw": raw, "streams": streams, "truncated": truncated}


def read_tags(path: str, full: bool = False) -> dict | None:
    """The tags of one file, or None for a non-media file, a hidden file, a symlink, a
    file that vanished or one the tool could not read."""
    path = path.rstrip(os.sep) or path
    name = os.path.basename(path)
    kind = kind_of(name)
    if kind == "other" or is_hidden(name):
        return None
    try:
        st = os.lstat(path)
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):  # also rejects symlinks
        return None
    return _read_image(path, full) if kind == "image" else _read_media(path, full)


def get_tags(paths: list[str], full: bool = False) -> dict[str, dict | None]:
    """Tags per path (``None`` where a file has none to read)."""
    unique = list(dict.fromkeys(paths))
    return dict(zip(unique, _pool.map(lambda p: read_tags(p, full), unique), strict=True))
