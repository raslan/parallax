"""Preview a subtitle candidate without saving it beside the video.

The download is decoded, summarised and written as WebVTT into `DATA_DIR/subtitle-previews/`
(the only place this module writes), so the player can show it over the video. Files there are
temporary: `sweep_previews` runs at startup and before each new preview.
"""

import os
import re
import secrets
import time

from app.config import DATA_DIR
from app.services.srt_io import Cue, decode_srt, format_timestamp, parse_srt
from app.services.subtitle_files import SubtitleFileError, _owned, unmatched_entry
from app.services.subtitle_lengths import length_verdict
from app.services.subtitle_providers import MAX_SUBTITLE_BYTES, ProviderError, get_provider
from app.services.subtitle_service import SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS

PREVIEW_DIR = os.path.join(DATA_DIR, "subtitle-previews")
PREVIEW_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,32}$")
MAX_DOWNLOAD_BYTES = MAX_SUBTITLE_BYTES
MAX_AGE_SECONDS = 3600
MAX_LINES = 200
LINE_CHARS = 120

# Older subtitles in these languages are usually in a legacy code page, not UTF-8 or cp1252.
_LEGACY_ENCODINGS = {
    "ar": "cp1256",
    "fa": "cp1256",
    "he": "cp1255",
    "ru": "cp1251",
    "uk": "cp1251",
    "bg": "cp1251",
    "el": "cp1253",
    "tr": "cp1254",
}


def _decode(data: bytes, language: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    legacy = _LEGACY_ENCODINGS.get(language.lower().split("-")[0])
    if legacy:
        try:
            return data.decode(legacy)
        except UnicodeDecodeError:
            pass
    return decode_srt(data)


def sweep_previews(max_age: float = MAX_AGE_SECONDS) -> int:
    """Delete preview files older than `max_age` seconds. Returns how many were removed."""
    removed = 0
    try:
        names = os.listdir(PREVIEW_DIR)
    except OSError:
        return 0
    cutoff = time.time() - max_age
    for name in names:
        path = os.path.join(PREVIEW_DIR, name)
        try:
            if (
                os.path.isfile(path)
                and not os.path.islink(path)
                and os.path.getmtime(path) < cutoff
            ):
                os.remove(path)
                removed += 1
        except OSError:
            continue
    return removed


def _vtt(cues: list[Cue]) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(
            f"{format_timestamp(c.start).replace(',', '.')} --> "
            f"{format_timestamp(c.end).replace(',', '.')}\n{c.text}\n"
        )
    return "\n".join(out)


def _sample(cues: list[Cue]) -> list[dict]:
    n = len(cues)
    idx = (
        range(n)
        if n <= MAX_LINES
        else sorted({round(i * (n - 1) / (MAX_LINES - 1)) for i in range(MAX_LINES)})
    )
    return [
        {"start": cues[i].start, "text": cues[i].text.replace("\n", " ")[:LINE_CHARS]} for i in idx
    ]


def create_preview(
    video_path: str,
    provider: str,
    subtitle_id: str,
    language: str,
    video_duration: float | None = None,
) -> dict:
    """Download a candidate and write it as temporary WebVTT. `video_path` is only the video's
    name for context: nothing is written beside it. The caller supplies the probed duration."""
    try:
        data = get_provider(provider).download(subtitle_id)
    except ValueError as exc:
        raise ProviderError(str(exc)) from exc
    if not data:
        raise ProviderError("The source returned no subtitle for that choice.")
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ProviderError("The download is too large to be a subtitle file.")
    cues = parse_srt(_decode(data, language))
    if not cues:
        raise ProviderError("The download is not a readable subtitle file.")
    return _write_preview(cues, video_duration)


def create_existing_preview(
    video_path: str,
    subtitle_path: str,
    video_duration: float | None = None,
) -> dict:
    """Describe a subtitle the video already has (any of its own files, a `.original` backup
    included) and write it as temporary WebVTT. Nothing is written beside the video."""
    (entry,) = _owned(video_path, [subtitle_path])
    return _preview_entry(entry, video_duration)


def create_unmatched_preview(
    root: str, subtitle_path: str, video_duration: float | None = None
) -> dict:
    """The same for a subtitle found beside no video; `root` is the folder it was found in."""
    return _preview_entry(unmatched_entry(root, subtitle_path), video_duration)


def _preview_entry(entry: dict, video_duration: float | None) -> dict:
    try:
        with open(entry["path"], "rb") as f:
            data = f.read(MAX_DOWNLOAD_BYTES + 1)
    except OSError as e:
        raise SubtitleFileError(f"Could not read the file: {e.strerror or e}") from e
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise SubtitleFileError("The file is too large to be a subtitle file.")
    cues = parse_srt(_decode(data, entry["language"] or ""))
    if not cues:
        raise SubtitleFileError("That file is not a readable subtitle file.")
    return _write_preview(cues, video_duration)


def _write_preview(cues: list[Cue], video_duration: float | None) -> dict:
    sweep_previews()
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    preview_id = secrets.token_urlsafe(12)
    path = os.path.join(PREVIEW_DIR, preview_id + ".vtt")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(_vtt(cues))
    os.replace(tmp, path)

    first = min(c.start for c in cues)
    last = max(c.end for c in cues)
    return {
        "preview_id": preview_id,
        "cues": len(cues),
        "first": first,
        "last": last,
        "video_duration": video_duration,
        "length": length_verdict(last, video_duration),
        "lines": _sample(cues),
    }


def preview_path(preview_id: str) -> str | None:
    """The temporary file for a well-formed id, else None. The pattern check comes first, so
    nothing a client sends can reach the filesystem as a path."""
    if not PREVIEW_ID_PATTERN.fullmatch(preview_id):
        return None
    path = os.path.join(PREVIEW_DIR, preview_id + ".vtt")
    return path if os.path.isfile(path) else None


_RESOLUTION = re.compile(r"(?<![A-Za-z0-9])(2160p|1080p|720p|480p)(?![A-Za-z0-9])", re.I)
_SOURCE = re.compile(
    r"(?<![A-Za-z0-9])(WEB-DL|WEBDL|WEBRip|WEB|BluRay|BDRip|BRRip|HDTV|DVDRip|REMUX)(?![A-Za-z0-9])",
    re.I,
)


def _stem(name: str) -> str:
    base, ext = os.path.splitext(name.strip())
    return base if ext.lower() in VIDEO_EXTENSIONS | SUBTITLE_EXTENSIONS else name.strip()


def _tokens(name: str) -> dict[str, str | None]:
    stem = _stem(name)
    res = _RESOLUTION.search(stem)
    src = _SOURCE.search(stem)
    rest = _SOURCE.sub(" ", _RESOLUTION.sub(" ", stem))
    group = None
    m = re.search(r"-([A-Za-z0-9]+)\s*$", rest)
    if m:
        group = m.group(1)
    elif (res or src) and re.search(r"\.([A-Za-z0-9]+)$", stem):
        last = re.search(r"\.([A-Za-z0-9]+)$", stem).group(1)
        if not _RESOLUTION.fullmatch(last) and not _SOURCE.fullmatch(last):
            group = last
    return {
        "resolution": res.group(1).lower() if res else None,
        "source": src.group(1).lower() if src else None,
        "group": group.lower() if group else None,
    }


def release_tokens(release: str, video_name: str) -> dict:
    """Compare resolution, source and release group between a candidate's release name and the
    video's file name. `match` is None when either side lacks the token."""
    a, b = _tokens(release), _tokens(video_name)
    out = {}
    for key in ("resolution", "source", "group"):
        shown = _display(release, key)
        out[key] = {
            "value": shown,
            "match": None if a[key] is None or b[key] is None else a[key] == b[key],
        }
    return out


def _display(release: str, key: str) -> str | None:
    """The token as written in the release name (original case)."""
    stem = _stem(release)
    if key == "resolution":
        m = _RESOLUTION.search(stem)
        return m.group(1) if m else None
    if key == "source":
        m = _SOURCE.search(stem)
        return m.group(1) if m else None
    low = _tokens(release)["group"]
    if low is None:
        return None
    m = re.search(re.escape(low) + r"\s*$", stem, re.I)
    return m.group(0).strip() if m else low
