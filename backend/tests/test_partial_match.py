"""The shared-audio matcher on synthetic fingerprints, plus the ffmpeg call with a fake process."""

import subprocess

import numpy as np
import pytest

from app.services import partial_match
from app.services.partial_match import (
    FRAMES_PER_SECOND,
    Fingerprint,
    FingerprintCancelled,
    extract_full_fingerprint,
    match_pair,
)


def _noisy(frames: np.ndarray, rng: np.random.Generator, p: float) -> np.ndarray:
    bits = rng.random((len(frames), 32)) < p
    mask = (bits.astype(np.uint64) << np.arange(32, dtype=np.uint64)).sum(axis=1)
    return (frames.view(np.uint32) ^ mask.astype(np.uint32)).view(np.int32)


def _random_frames(rng: np.random.Generator, n: int) -> np.ndarray:
    return rng.integers(-(2**31), 2**31 - 1, size=n, dtype=np.int64).astype(np.int32)


def test_subset_spliced_from_two_pieces_is_found():
    rng = np.random.default_rng(1)
    long_ = _random_frames(rng, 6000)
    short = _noisy(np.concatenate([long_[1000:1800], long_[3500:4100]]), rng, 0.08)

    m = match_pair(Fingerprint(short), Fingerprint(long_))

    assert m is not None
    assert m.coverage_short > 0.9
    assert 0.2 < m.coverage_long < 0.3
    assert m.segments == 2
    assert abs(m.offsets_s[0] - 1000 / FRAMES_PER_SECOND) < 1.0
    assert abs(m.offsets_s[1] - (3500 - 800) / FRAMES_PER_SECOND) < 1.0


def test_argument_order_does_not_matter():
    rng = np.random.default_rng(2)
    long_ = _random_frames(rng, 4000)
    short = _noisy(long_[500:1500], rng, 0.08)

    a = match_pair(Fingerprint(short), Fingerprint(long_))
    b = match_pair(Fingerprint(long_), Fingerprint(short))

    assert a is not None and b is not None
    assert a.coverage_short == b.coverage_short


def test_equal_length_tracks_score_the_same_whichever_comes_first():
    # Different lengths always sort the same way, so they can't show an asymmetry. Equal
    # lengths are the case where the argument order decides which track is "the shorter".
    rng = np.random.default_rng(4)
    common = _random_frames(rng, 800)
    x = np.concatenate([common, _random_frames(rng, 1200)])
    y = np.concatenate([_random_frames(rng, 1200), _noisy(common, rng, 0.05)])
    assert len(x) == len(y)

    a = match_pair(Fingerprint(x), Fingerprint(y))
    b = match_pair(Fingerprint(y), Fingerprint(x))

    assert a is not None and b is not None
    assert a.coverage_short == b.coverage_short
    assert a.coverage_long == b.coverage_long


def test_unrelated_audio_does_not_match():
    rng = np.random.default_rng(3)
    a = Fingerprint(_random_frames(rng, 5000))
    b = Fingerprint(_random_frames(rng, 7000))

    m = match_pair(a, b)

    assert m is None or m.coverage_short < 0.02


def test_silence_does_not_match_silence():
    a = Fingerprint(np.zeros(3000, dtype=np.int32))
    b = Fingerprint(np.zeros(5000, dtype=np.int32))

    assert match_pair(a, b) is None


class _FakeFfmpeg:
    """Stands in for the ffmpeg process: runs forever until killed, or ends with `result`."""

    def __init__(self, result: tuple[bytes, bytes, int] | None = None):
        self.result = result
        self.killed = False
        self.returncode = None

    def communicate(self, timeout=None):
        if self.result is not None:
            out, err, self.returncode = self.result
            return out, err
        if self.killed:
            return b"", b""
        raise subprocess.TimeoutExpired("ffmpeg", timeout)

    def poll(self):
        return self.returncode if (self.result is not None or self.killed) else None

    def kill(self):
        self.killed = True


def test_cancelling_kills_ffmpeg_at_once(monkeypatch):
    proc = _FakeFfmpeg()
    monkeypatch.setattr(partial_match.subprocess, "Popen", lambda *a, **k: proc)

    with pytest.raises(FingerprintCancelled):
        extract_full_fingerprint("x.mkv", is_cancelled=lambda: True)

    assert proc.killed


def test_ffmpeg_never_reads_stdin(monkeypatch):
    seen = {}

    def popen(cmd, **kwargs):
        seen.update(cmd=cmd, **kwargs)
        return _FakeFfmpeg((np.arange(4, dtype="<i4").tobytes(), b"", 0))

    monkeypatch.setattr(partial_match.subprocess, "Popen", popen)

    frames = extract_full_fingerprint("x.mkv")

    assert list(frames) == [0, 1, 2, 3]
    assert "-nostdin" in seen["cmd"] and seen["stdin"] is subprocess.DEVNULL


def test_a_file_ffmpeg_cannot_read_gives_none_and_says_why(monkeypatch, caplog):
    proc = _FakeFfmpeg((b"", b"first line\nOutput file does not contain any stream\n", 1))
    monkeypatch.setattr(partial_match.subprocess, "Popen", lambda *a, **k: proc)

    with caplog.at_level("WARNING", logger="app.services.partial_match"):
        assert extract_full_fingerprint("silent.mkv") is None

    assert "does not contain any stream" in caplog.text and "silent.mkv" in caplog.text
