"""The shared-audio matcher: does one file's audio appear inside another's?

It finds files that share *some* audio (a clip cut from a longer video, a theatrical cut
inside an extended one) when size, duration and the picture all differ. Pure numpy and
ffmpeg: no DB, no app imports. `shared_audio.py` runs it over a library for the
Duplicates pages.

Method (Shazam-style offset voting, then verification):
  1. Fingerprint the whole track (~8 frames/s, one int32 each).
  2. Candidate offsets: frames whose 16-bit halves collide vote for the time
     offset ``d = i_a - j_b``. Real shared audio piles votes on a few offsets;
     chance collisions spread out.
  3. Verify each candidate offset in 5 s windows by bit error rate (unrelated
     audio is ~0.4-0.5, the same audio re-encoded is far lower). Windows that
     pass mark frames as covered on both sides; offsets are unioned, so a file
     spliced from several pieces still scores as the sum of its pieces.
  4. Report the share of each track that is covered, plus how many separate
     chunks of the longer track were used and the longest one.
"""

from __future__ import annotations

import logging
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

FRAMES_PER_SECOND = 1 / 0.1238  # chromaprint item duration

_POP8 = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)

# Candidate generation
MAX_BUCKET = 8  # ignore keys that occur more often than this (silence, loops)
SMOOTH = 3  # votes within +-3 frames count as one offset (small drift)
MIN_VOTES = 10
MAX_OFFSETS = 12
SUPPRESS = 24  # frames around a chosen offset that can't be chosen again

# Verification
WINDOW = 40  # frames (~5 s)
MAX_BER = 0.35  # fraction of differing bits allowed in a passing window
MIN_CHANGE = 0.5  # a window must change frame-to-frame (rejects silence)


def popcount32(x: np.ndarray) -> np.ndarray:
    x = x.view(np.uint32) if x.dtype == np.int32 else x.astype(np.uint32, copy=False)
    return _POP8[x & 0xFF] + _POP8[(x >> 8) & 0xFF] + _POP8[(x >> 16) & 0xFF] + _POP8[x >> 24]


class Fingerprint:
    """A full-track fingerprint with lazily built per-half sort indexes."""

    def __init__(self, frames: np.ndarray):
        self.frames = np.ascontiguousarray(frames, dtype=np.int32)
        self._index: dict[int, tuple[np.ndarray, np.ndarray]] = {}

    def __len__(self) -> int:
        return len(self.frames)

    def keys(self, shift: int) -> np.ndarray:
        return (self.frames.view(np.uint32) >> shift) & 0xFFFF

    def index(self, shift: int) -> tuple[np.ndarray, np.ndarray]:
        if shift not in self._index:
            k = self.keys(shift)
            order = np.argsort(k, kind="stable")
            self._index[shift] = (k[order], order)
        return self._index[shift]


class FingerprintCancelled(Exception):
    """Raised by `extract_full_fingerprint` when `is_cancelled()` turned true mid-run."""


_POLL_SECONDS = 0.25


def extract_full_fingerprint(
    path: str,
    timeout: float = 1800.0,
    is_cancelled: Callable[[], bool] | None = None,
) -> np.ndarray | None:
    """Whole first audio stream, no length cap. None when the file has no usable audio.

    ffmpeg is polled every quarter second, so a cancel (`is_cancelled()`) kills it at once
    instead of waiting for a big file to finish (raises `FingerprintCancelled`). It does not
    read stdin, so it can never block waiting on a terminal.
    """
    proc = subprocess.Popen(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            path,
            "-map",
            "0:a:0?",
            "-ac",  # chromaprint refuses >2 channels, so 5.1 tracks need a downmix
            "1",
            "-f",
            "chromaprint",
            "-fp_format",
            "raw",
            "-",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + timeout
    try:
        while True:
            if is_cancelled is not None and is_cancelled():
                raise FingerprintCancelled
            if time.monotonic() > deadline:
                logger.warning("ffmpeg timed out fingerprinting %s", path)
                return None
            try:
                stdout, stderr = proc.communicate(timeout=_POLL_SECONDS)
                break
            except subprocess.TimeoutExpired:
                continue
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.communicate()
    n = len(stdout) // 4
    if proc.returncode != 0 or n == 0:
        tail = stderr.decode(errors="replace").strip().splitlines()[-1:] or ["no audio output"]
        logger.warning(
            "ffmpeg could not fingerprint %s (exit %s): %s", path, proc.returncode, tail[0]
        )
        return None
    return np.frombuffer(stdout[: n * 4], dtype="<i4").copy()


def candidate_offsets(a: Fingerprint, b: Fingerprint) -> list[tuple[int, int]]:
    """Return [(d, votes)] where ``a[i]`` should line up with ``b[i - d]``."""
    na, nb = len(a), len(b)
    votes = np.zeros(na + nb + 1, dtype=np.int64)
    for shift in (0, 16):
        ka = a.keys(shift)
        kb_sorted, order = b.index(shift)
        lo = np.searchsorted(kb_sorted, ka, "left")
        hi = np.searchsorted(kb_sorted, ka, "right")
        cnt = hi - lo
        ok = (cnt > 0) & (cnt <= MAX_BUCKET)
        if not ok.any():
            continue
        ia = np.nonzero(ok)[0]
        c = cnt[ok]
        rep_i = np.repeat(ia, c)
        starts = np.repeat(lo[ok], c)
        within = np.arange(len(rep_i)) - np.repeat(np.cumsum(c) - c, c)
        jb = order[starts + within]
        votes += np.bincount(rep_i - jb + nb, minlength=na + nb + 1)

    smoothed = np.convolve(votes, np.ones(2 * SMOOTH + 1, dtype=np.int64), mode="same")
    picked: list[tuple[int, int]] = []
    work = smoothed.copy()
    for _ in range(MAX_OFFSETS):
        peak = int(work.argmax())
        if work[peak] < MIN_VOTES:
            break
        lo_i, hi_i = max(0, peak - SMOOTH), min(len(votes), peak + SMOOTH + 1)
        best = lo_i + int(votes[lo_i:hi_i].argmax())
        picked.append((best - nb, int(work[peak])))
        work[max(0, peak - SUPPRESS) : peak + SUPPRESS + 1] = 0
    return picked


def verify_offset(
    a: np.ndarray, b: np.ndarray, d: int, max_ber: float = MAX_BER
) -> tuple[int, int, np.ndarray] | None:
    """Frames ``a[i0:i1]`` vs ``b[i0-d:i1-d]``. Returns (i0, i1, covered_mask)."""
    na, nb = len(a), len(b)
    i0, i1 = max(0, d), min(na, nb + d)
    n = i1 - i0
    if n < WINDOW:
        return None
    seg_a = a[i0:i1]
    err = popcount32(seg_a ^ b[i0 - d : i1 - d]).astype(np.int64)
    c = np.concatenate(([0], np.cumsum(err)))
    wsum = c[WINDOW:] - c[:-WINDOW]
    good = wsum <= max_ber * 32 * WINDOW

    changed = (seg_a[1:] != seg_a[:-1]).astype(np.int64)
    cc = np.concatenate(([0], np.cumsum(changed)))
    wchg = cc[WINDOW - 1 :] - cc[: n - WINDOW + 1]
    good &= wchg >= MIN_CHANGE * (WINDOW - 1)

    starts = np.nonzero(good)[0]
    if len(starts) == 0:
        return None
    mark = np.bincount(starts, minlength=n + 1) - np.bincount(starts + WINDOW, minlength=n + 1)
    return i0, i1, np.cumsum(mark[:n]) > 0


def _runs(mask: np.ndarray) -> np.ndarray:
    m = np.concatenate(([0], mask.astype(np.int8), [0]))
    dm = np.diff(m)
    return np.nonzero(dm == -1)[0] - np.nonzero(dm == 1)[0]


def _keep_long_runs(mask: np.ndarray, min_frames: int) -> np.ndarray:
    """`mask` with every unbroken run of True shorter than `min_frames` cleared."""
    dm = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    out = np.zeros_like(mask)
    for start, end in zip(np.nonzero(dm == 1)[0], np.nonzero(dm == -1)[0]):
        if end - start >= min_frames:
            out[start:end] = True
    return out


@dataclass
class PartialMatch:
    coverage_short: float  # share of the shorter track that is found in the longer
    coverage_long: float  # share of the longer track that is found in the shorter
    segments: int  # separate chunks of the longer track that the shorter one uses
    longest_s: float  # longest such chunk, seconds
    matched_s: float  # total matched audio, seconds
    offsets_s: list[float]  # verified offsets (long position - short position)


def match_pair(
    x: Fingerprint, y: Fingerprint, max_ber: float = MAX_BER, min_stretch_s: float = 0.0
) -> PartialMatch | None:
    """Compare two fingerprints; the shorter one is treated as the candidate subset.

    `max_ber` is how many bits of a window may differ (0.25 = windows must be 75% alike).
    `min_stretch_s`: shared audio only counts inside stretches that run this long
    unbroken in the shorter track. It is capped just under the shorter track's own
    length, so a clip shorter than the setting can still match whole.
    """
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    cands = candidate_offsets(short, long_)
    if not cands:
        return None
    mask_s = np.zeros(len(short), dtype=bool)
    verified = []
    for d, _votes in cands:
        res = verify_offset(short.frames, long_.frames, d, max_ber)
        if res is None:
            continue
        i0, i1, covered = res
        mask_s[i0:i1] |= covered
        verified.append((d, i0, i1, covered))
    min_frames = min(round(min_stretch_s * FRAMES_PER_SECOND), int(0.9 * len(short)))
    if min_frames > 1:
        mask_s = _keep_long_runs(mask_s, min_frames)
    if not mask_s.any():
        return None
    mask_l = np.zeros(len(long_), dtype=bool)
    used: list[float] = []
    for d, i0, i1, covered in verified:
        kept = covered & mask_s[i0:i1]
        if kept.any():
            mask_l[i0 - d : i1 - d] |= kept
            used.append(-d / FRAMES_PER_SECOND)
    runs = _runs(mask_l)  # chunks of the long file the short one is made of
    return PartialMatch(
        coverage_short=float(mask_s.mean()),
        coverage_long=float(mask_l.mean()),
        segments=int(len(runs)),
        longest_s=float(runs.max() / FRAMES_PER_SECOND),
        matched_s=float(mask_s.sum() / FRAMES_PER_SECOND),
        offsets_s=sorted(used),
    )
