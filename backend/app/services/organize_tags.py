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


def tags_of(probe: dict) -> dict[str, str]:
    """The tags ffprobe found: the container's, else the first audio stream's.

    Ogg and Opus keep their Vorbis comments on the stream and leave ``format.tags`` empty.
    The stream's tags are only a fallback (they also carry per-track noise such as
    ``DURATION`` and ``language`` that a container with real tags would drown in).
    """
    container = (probe.get("format") or {}).get("tags") or {}
    if container:
        return container
    for stream in probe.get("streams") or []:
        if stream.get("codec_type") == "audio":
            return stream.get("tags") or {}
    return {}


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
    fields, raw, truncated = fields_from_tags(tags_of(probe), full)
    streams = [_stream_line(s) for s in probe.get("streams") or []]
    return _shape(fields, raw, streams, truncated, full)


def _shape(
    fields: dict[str, str], raw: dict[str, str], streams: list[str], truncated: bool, full: bool
) -> dict:
    """The result for one file. Batch reads (``full`` False, for the list's columns and
    filters) carry only the canonical ``fields``; the raw tags and the streams are for the
    one-file panel, which asks with ``full``."""
    if not full:
        raw, streams = {}, []
    return {"fields": fields, "raw": raw, "streams": streams, "truncated": truncated}


def _read_images(paths: list[str], full: bool) -> dict[str, dict | None]:
    """Tags of several images from ONE exiftool process (one start-up, not one per file).

    exiftool echoes each file's path as ``SourceFile``; a path it printed nothing for is
    None. Paths must be eligible already (see `_eligible`).
    """
    if not paths:
        return {}
    out = _run(["exiftool", "-j", "-G1", "-a", "--", *(_arg(p) for p in paths)])
    entries: dict[str, dict] = {}
    if out is not None:
        try:
            for entry in json.loads(out):
                entries[entry.get("SourceFile", "")] = entry
        except (ValueError, TypeError, AttributeError):
            entries = {}
    result: dict[str, dict | None] = {}
    for path in paths:
        entry = entries.get(_arg(path))
        if entry is None:
            result[path] = None
            continue
        fields, raw, truncated = fields_from_exiftool(entry, full)
        width, height = entry.get("File:ImageWidth"), entry.get("File:ImageHeight")
        fmt = str(entry.get("File:FileType", "image")).lower()
        streams = [f"image {fmt} {width}×{height}" if width and height else f"image {fmt}"]
        result[path] = _shape(fields, raw, streams, truncated, full)
    return result


def _eligible(path: str) -> str | None:
    """The file's kind (``video``/``audio``/``image``) when it can carry tags: a regular,
    visible, non-symlink file of a media kind. None otherwise (also when it vanished)."""
    name = os.path.basename(path)
    kind = kind_of(name)
    if kind == "other" or is_hidden(name):
        return None
    try:
        st = os.lstat(path)
    except OSError:
        return None
    return kind if stat.S_ISREG(st.st_mode) else None  # also rejects symlinks


def read_tags(path: str, full: bool = False) -> dict | None:
    """The tags of one file, or None for a non-media file, a hidden file, a symlink, a
    file that vanished or one the tool could not read."""
    return get_tags([path], full)[path]


def get_tags(paths: list[str], full: bool = False) -> dict[str, dict | None]:
    """Tags per path (``None`` where a file has none to read). Video and audio go through
    ffprobe one file at a time on a small pool; all the images share one exiftool call."""
    unique = list(dict.fromkeys(paths))
    result: dict[str, dict | None] = dict.fromkeys(unique)
    images: list[str] = []
    media: list[str] = []
    for path in unique:
        kind = _eligible(path.rstrip(os.sep) or path)
        if kind == "image":
            images.append(path)
        elif kind is not None:
            media.append(path)
    result.update(_read_images(images, full))
    for path, tags in zip(media, _pool.map(lambda p: _read_media(p, full), media), strict=True):
        result[path] = tags
    return result
