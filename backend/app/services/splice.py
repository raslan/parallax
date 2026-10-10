"""Splice (merge) — concatenate several videos into one new file.

Pure helpers first (probe parsing, compatibility verdict, concat list,
chapters, ffmpeg arg builders), then `perform_merge` (ffmpeg → verify → move
sources to `_originals/` → rename into place; no DB) and `run_splice_job`
(the Job wrapper + watcher rescan).
"""

import json
import subprocess
from dataclasses import dataclass

_FPS_TOLERANCE = 0.01
_NAME_MAX_BYTES = 200
_FORBIDDEN_NAME_CHARS = set("/\\\x00")


@dataclass(frozen=True)
class StreamFacts:
    path: str
    duration: float
    vcodec: str | None
    width: int | None
    height: int | None
    fps: float | None
    pix_fmt: str | None
    acodec: str | None
    sample_rate: int | None
    channels: int | None

    @property
    def has_audio(self) -> bool:
        return self.acodec is not None


def _fraction(value: str | None) -> float | None:
    if not value:
        return None
    try:
        if "/" in value:
            num, den = value.split("/", 1)
            return float(num) / float(den) if float(den) else None
        return float(value)
    except ValueError:
        return None


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_probe(path: str, data: dict) -> StreamFacts:
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return StreamFacts(
        path=path,
        duration=duration,
        vcodec=video.get("codec_name"),
        width=_int(video.get("width")),
        height=_int(video.get("height")),
        fps=_fraction(video.get("r_frame_rate")),
        pix_fmt=video.get("pix_fmt"),
        acodec=audio.get("codec_name"),
        sample_rate=_int(audio.get("sample_rate")),
        channels=_int(audio.get("channels")),
    )


def probe_facts(path: str) -> StreamFacts:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return parse_probe(path, json.loads(result.stdout or "{}"))


def mismatch_reasons(ref: StreamFacts, other: StreamFacts) -> list[str]:
    reasons: list[str] = []
    if other.vcodec != ref.vcodec:
        reasons.append(f"video codec {other.vcodec} ≠ {ref.vcodec}")
    if (other.width, other.height) != (ref.width, ref.height):
        reasons.append(f"resolution {other.width}×{other.height} ≠ {ref.width}×{ref.height}")
    if (other.fps is None) != (ref.fps is None) or (
        other.fps is not None and ref.fps is not None and abs(other.fps - ref.fps) > _FPS_TOLERANCE
    ):
        reasons.append(f"frame rate {other.fps} ≠ {ref.fps}")
    if other.pix_fmt != ref.pix_fmt:
        reasons.append(f"pixel format {other.pix_fmt} ≠ {ref.pix_fmt}")
    if ref.has_audio and not other.has_audio:
        reasons.append("no audio (silence will be added)")
    elif other.has_audio and not ref.has_audio:
        reasons.append("has audio but the reference has none")
    elif other.has_audio:
        if other.acodec != ref.acodec:
            reasons.append(f"audio codec {other.acodec} ≠ {ref.acodec}")
        if other.sample_rate != ref.sample_rate:
            reasons.append(f"sample rate {other.sample_rate} ≠ {ref.sample_rate}")
        if other.channels != ref.channels:
            reasons.append(f"channels {other.channels} ≠ {ref.channels}")
    return reasons


def verdict_for(ref: StreamFacts, others: list[StreamFacts]) -> str:
    return "reencode" if any(mismatch_reasons(ref, o) for o in others) else "copy"


def validate_output_name(name: str) -> str:
    """Return the cleaned stem (the caller appends the extension)."""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Output name is empty")
    if any(c in _FORBIDDEN_NAME_CHARS for c in cleaned):
        raise ValueError("Output name may not contain path separators")
    if cleaned.startswith(".") or cleaned in {".", ".."}:
        raise ValueError("Output name may not start with a dot")
    if len(cleaned.encode()) > _NAME_MAX_BYTES:
        raise ValueError("Output name is too long")
    return cleaned


def build_concat_list(paths: list[str]) -> str:
    lines = []
    for p in paths:
        escaped = p.replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    return "\n".join(lines) + "\n"


def _meta_escape(text: str) -> str:
    for ch in ("\\", "=", ";", "#", "\n"):
        text = text.replace(ch, "\\" + ch)
    return text


def build_chapters_ffmetadata(items: list[tuple[str, float]]) -> str:
    out = [";FFMETADATA1"]
    start_ms = 0
    for title, duration in items:
        end_ms = start_ms + round(duration * 1000)
        out.append(
            f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={start_ms}\nEND={end_ms}\ntitle={_meta_escape(title)}"
        )
        start_ms = end_ms
    return "\n".join(out) + "\n"


def duration_ok(actual: float, expected: float) -> bool:
    if actual <= 0:
        return False
    return abs(actual - expected) <= max(2.0, expected * 0.01)
