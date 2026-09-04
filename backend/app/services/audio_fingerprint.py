"""Audio fingerprint extraction via ffmpeg's built-in chromaprint muxer
(confirmed present in this image: `ffmpeg -muxers | grep chromaprint`).
Comparison reuses the same avg-of-minimums Hamming approach already used
for multi-frame pHash comparison (see duplicates.py's `_frames_distance`) —
same shape, different signal.

A full-length raw fingerprint is one ~32-bit int per ~1/8s of audio, so a
two-hour movie produces tens of thousands of ints — comparing two of those
pairwise (O(n*m) Hamming ops) would be needlessly expensive for a signal
that only needs to answer "is this roughly the same audio." Downsampled to
a small fixed sample count, same principle as pHash's fixed frame count
regardless of video length.
"""

import struct

from app.services.common import should_cancel
from app.services.phash_scanner import _Cancelled, _run_capture_cancelable

AUDIO_FINGERPRINT_SAMPLES = 32


def _downsample(values: list[int], target: int) -> list[int]:
    if len(values) <= target:
        return values
    step = len(values) / target
    return [values[int(i * step)] for i in range(target)]


def _extract_raw_fingerprint(path: str, job_id: int | None) -> list[int]:
    stdout = _run_capture_cancelable(
        [
            "ffmpeg",
            "-y",
            "-i",
            path,
            "-map",
            "0:a:0?",
            "-f",
            "chromaprint",
            "-fp_format",
            "raw",
            "-",
            "-hide_banner",
            "-loglevel",
            "error",
        ],
        job_id,
        timeout=60.0,
    )
    n = len(stdout) // 4
    if n == 0:
        return []
    return list(struct.unpack(f"<{n}i", stdout[: n * 4]))


def compute_audio_fingerprint(path: str, job_id: int | None = None) -> list[int] | None:
    if job_id is not None and should_cancel(job_id):
        raise _Cancelled()
    try:
        raw = _extract_raw_fingerprint(path, job_id)
    except _Cancelled:
        raise
    except Exception:
        return None
    if not raw:
        return None
    return _downsample(raw, AUDIO_FINGERPRINT_SAMPLES)


def _hamming(a: int, b: int) -> int:
    return bin((a ^ b) & 0xFFFFFFFF).count("1")


def audio_fingerprint_distance(a: list[int], b: list[int]) -> float:
    """Average of per-value minimum Hamming distances — mirrors
    duplicates.py's `_frames_distance` for multi-frame pHash."""
    if not a or not b:
        return float("inf")
    total = 0.0
    for va in a:
        total += min(_hamming(va, vb) for vb in b)
    for vb in b:
        total += min(_hamming(va, vb) for va in a)
    return total / (len(a) + len(b))
