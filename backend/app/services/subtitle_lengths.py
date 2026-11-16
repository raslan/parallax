"""Compare a subtitle's last cue with the video's runtime. A hint, never a verdict."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from app.services import scanner
from app.services.srt_io import decode_srt, parse_srt
from app.services.subtitle_files import list_subtitle_files
from app.services.subtitle_providers import MAX_SUBTITLE_BYTES
from app.services.subtitle_service import VIDEO_EXTENSIONS

logger = logging.getLogger(__name__)

MAX_PATHS = 25
PROBE_WORKERS = 4
# `original` sync backups are never checked.
CHECKED_KINDS = ("real", "generated", "translated", "hearing_impaired")

# A subtitle ending before 88% of the runtime is "short" (credits and recaps leave some slack).
SHORT_TOLERANCE = 0.12
# A subtitle ending more than 5% past the runtime is "long".
LONG_THRESHOLD = 1.05


def length_verdict(
    last_cue: float, video_duration: float | None, tolerance: float = SHORT_TOLERANCE
) -> str:
    if not video_duration or video_duration <= 0:
        return "unknown"
    if last_cue < video_duration * (1 - tolerance):
        return "short"
    if last_cue > video_duration * LONG_THRESHOLD:
        return "long"
    return "ok"


def _is_checkable(path: object) -> bool:
    return (
        isinstance(path, str)
        and bool(path)
        and "\0" not in path
        and os.path.splitext(path)[1].lower() in VIDEO_EXTENSIONS
        and os.path.isfile(path)
    )


def _duration(path: str) -> float | None:
    try:
        meta = scanner.probe_metadata(path)
    except Exception:  # a dead mount or odd file costs only this video's duration
        logger.warning("Length check: probe failed for a video", exc_info=True)
        return None
    if not meta.get("probe_ok"):
        return None
    return meta.get("duration")


def _last_cue(path: str) -> float | None:
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_SUBTITLE_BYTES + 1)
        if len(data) > MAX_SUBTITLE_BYTES:  # not a subtitle file: unknown, never read whole
            return None
        cues = parse_srt(decode_srt(data))
    except Exception:
        return None
    return max((c.end for c in cues), default=None)


def check_lengths(video_paths: list[str]) -> dict[str, dict | None]:
    """Per video: its runtime and each subtitle's last cue with a length verdict. A path that
    is not an existing video file maps to None (validated before any folder is listed). Only
    reads; ffprobe runs on a small bounded pool, folders are walked once via a shared cache."""
    valid = [p for p in dict.fromkeys(video_paths) if _is_checkable(p)]
    dirs_cache: dict[str, list[str]] = {}
    listings: dict[str, list[dict]] = {}
    for p in valid:
        try:
            listings[p] = [
                f for f in list_subtitle_files(p, dirs_cache) if f["kind"] in CHECKED_KINDS
            ]
        except Exception:  # vanished between the check and the listing
            logger.warning("Length check: listing failed for a video", exc_info=True)
    with ThreadPoolExecutor(max_workers=PROBE_WORKERS) as pool:
        durations = dict(zip(listings, pool.map(_duration, listings)))
    out: dict[str, dict | None] = {p: None for p in video_paths if isinstance(p, str)}
    for p, files in listings.items():
        duration = durations[p]
        subs = []
        for f in files:
            last = _last_cue(f["path"])
            verdict = "unknown" if last is None else length_verdict(last, duration)
            subs.append({"path": f["path"], "last_cue": last, "length": verdict})
        out[p] = {"duration": duration, "subtitles": subs}
    return out
