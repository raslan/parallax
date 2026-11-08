import numpy as np

from app.services import shared_audio
from app.services.duplicates import scope_extraction_groups
from app.services.partial_match import Fingerprint
from app.services.shared_audio import compute_shared_audio
from tests.test_duplicates_funnel import BASE_CRITERIA, _file


def _frames(rng: np.random.Generator, n: int) -> np.ndarray:
    return rng.integers(-(2**31), 2**31 - 1, size=n, dtype=np.int64).astype(np.int32)


def _run(groups, prints, monkeypatch, *, cancelled=False):
    monkeypatch.setattr(
        shared_audio, "cached_fingerprint", lambda fid, path, kind, is_cancelled=None: prints[fid]
    )
    seen: list[float] = []
    out = compute_shared_audio(
        groups, workers=1, is_cancelled=lambda: cancelled, on_progress=seen.append
    )
    return out, seen


def test_a_contained_clip_is_recorded_on_both_files_and_only_within_its_group(monkeypatch):
    rng = np.random.default_rng(7)
    long_ = _frames(rng, 6000)
    prints = {
        1: Fingerprint(long_),
        2: Fingerprint(long_[1000:1800].copy()),  # a piece of file 1
        3: Fingerprint(_frames(rng, 5000)),  # unrelated
        4: Fingerprint(long_),  # same audio as 1, but in another group
    }
    groups = [[(1, "a"), (2, "b"), (3, "c")], [(4, "d")]]

    out, progress = _run(groups, prints, monkeypatch)

    assert out is not None
    assert [other for other, _ in out[1]] == [2]
    assert [other for other, _ in out[2]] == [1]
    assert out[1][0][1] > 0.95 and out[2][0][1] == out[1][0][1]  # share of the shorter clip
    assert out[3] == []
    assert 4 not in out  # a group of one is never compared
    assert progress[-1] == 1.0


def test_cancelling_returns_none(monkeypatch):
    prints = {1: Fingerprint(np.zeros(500, np.int32)), 2: Fingerprint(np.ones(500, np.int32))}

    out, _ = _run([[(1, "a"), (2, "b")]], prints, monkeypatch, cancelled=True)

    assert out is None


def test_a_file_that_cannot_be_fingerprinted_is_skipped_and_not_retried(monkeypatch):
    rng = np.random.default_rng(8)
    long_ = _frames(rng, 3000)
    prints = {1: Fingerprint(long_), 2: Fingerprint(long_[500:1200].copy()), 3: None}
    calls: dict[int, int] = {}

    def fake(fid, path, kind, is_cancelled=None):
        calls[fid] = calls.get(fid, 0) + 1
        return prints[fid]

    monkeypatch.setattr(shared_audio, "cached_fingerprint", fake)

    out = compute_shared_audio(
        [[(1, "a"), (2, "b"), (3, "c")]],
        workers=1,
        is_cancelled=lambda: False,
        on_progress=lambda p: None,
    )

    assert [other for other, _ in out[1]] == [2]
    assert out[3] == []
    assert calls[3] == 1  # tried once in the fingerprinting phase, never again in matching


def test_the_plan_is_reported_before_any_work(monkeypatch):
    prints = {i: Fingerprint(np.zeros(200, np.int32)) for i in (1, 2, 3, 4)}
    monkeypatch.setattr(
        shared_audio, "cached_fingerprint", lambda fid, path, kind, is_cancelled=None: prints[fid]
    )
    plans = []

    compute_shared_audio(
        [[(1, "a"), (2, "b"), (3, "c")], [(4, "d")]],
        workers=1,
        is_cancelled=lambda: False,
        on_progress=lambda p: None,
        on_plan=lambda *plan: plans.append(plan),
    )

    # The group of one is not compared, so it is not counted: 3 files, 1 group, 3 pairs.
    assert plans == [(3, 1, 3)]


def test_describe_plan_only_warns_when_there_is_a_lot_to_do():
    message, level = shared_audio.describe_plan(300, 1, 44_850)
    assert level == "info" and "44,850 pairs" in message

    message, level = shared_audio.describe_plan(1000, 1, 499_500)
    assert level == "warning" and "hours" in message and "Filename" in message


def test_the_dials_a_run_measured_with_are_recorded_as_json():
    import json

    assert json.loads(
        shared_audio.measured_settings({"audio_similarity": 0.7, "audio_min_stretch": 12.0})
    ) == {"audio_similarity": 0.7, "audio_min_stretch": 12.0}
    # A request that predates the dials gets the defaults.
    assert json.loads(shared_audio.measured_settings({})) == {
        "audio_similarity": 0.75,
        "audio_min_stretch": 10.0,
    }


class TestCachedFingerprint:
    FRAMES = np.arange(300, dtype=np.int32)

    def _setup(self, monkeypatch, tmp_path, frames="default"):
        import os

        cache = tmp_path / "cache"
        monkeypatch.setattr(shared_audio, "CACHE_DIR", str(cache))
        media = tmp_path / "x.bin"
        media.write_bytes(b"x")
        calls = []

        def fake_extract(path, timeout=0, is_cancelled=None):
            calls.append(path)
            return self.FRAMES if frames == "default" else frames

        monkeypatch.setattr(shared_audio, "extract_full_fingerprint", fake_extract)
        st = os.stat(media)
        return cache, str(media), calls, f"{st.st_size}-{st.st_mtime_ns}.npy"

    def test_video_keeps_the_bare_key_and_other_kinds_get_a_prefix(self, monkeypatch, tmp_path):
        cache, media, _calls, suffix = self._setup(monkeypatch, tmp_path)

        shared_audio.cached_fingerprint(7, media)
        shared_audio.cached_fingerprint(7, media, "audio")

        assert sorted(p.name for p in cache.iterdir()) == sorted(
            [f"7-{suffix}", f"audio-7-{suffix}"]
        )

    def test_a_cache_hit_does_not_run_ffmpeg(self, monkeypatch, tmp_path):
        _cache, media, calls, _suffix = self._setup(monkeypatch, tmp_path)

        shared_audio.cached_fingerprint(1, media)
        again = shared_audio.cached_fingerprint(1, media)

        assert len(calls) == 1
        assert list(again.frames) == list(self.FRAMES)

    def test_a_torn_cache_file_is_recomputed(self, monkeypatch, tmp_path):
        cache, media, calls, suffix = self._setup(monkeypatch, tmp_path)
        cache.mkdir()
        (cache / f"1-{suffix}").write_bytes(b"not an npy file")

        fp = shared_audio.cached_fingerprint(1, media)

        assert len(calls) == 1 and len(fp) == len(self.FRAMES)

    def test_a_failed_cache_write_still_returns_the_fingerprint_and_leaves_nothing_behind(
        self, monkeypatch, tmp_path
    ):
        cache, media, _calls, _suffix = self._setup(monkeypatch, tmp_path)

        def broken_save(path, arr):
            open(path, "wb").write(b"partial")  # what a full disk leaves behind
            raise OSError("no space left on device")

        monkeypatch.setattr(shared_audio.np, "save", broken_save)

        fp = shared_audio.cached_fingerprint(1, media)

        assert len(fp) == len(self.FRAMES)
        assert list(cache.iterdir()) == []

    def test_a_file_with_no_audio_gives_none(self, monkeypatch, tmp_path):
        _cache, media, _calls, _suffix = self._setup(monkeypatch, tmp_path, frames=None)

        assert shared_audio.cached_fingerprint(1, media) is None

    def test_a_missing_file_gives_none(self, monkeypatch, tmp_path):
        self._setup(monkeypatch, tmp_path)

        assert shared_audio.cached_fingerprint(1, str(tmp_path / "gone.mkv")) is None

    def test_a_cancel_during_ffmpeg_propagates(self, monkeypatch, tmp_path):
        from app.services.partial_match import FingerprintCancelled

        _cache, media, _calls, _suffix = self._setup(monkeypatch, tmp_path)

        def cancelled(path, timeout=0, is_cancelled=None):
            raise FingerprintCancelled

        monkeypatch.setattr(shared_audio, "extract_full_fingerprint", cancelled)

        import pytest

        with pytest.raises(FingerprintCancelled):
            shared_audio.cached_fingerprint(1, media)


def test_funnel_groups_keep_files_apart_that_the_funnel_separates():
    files = [_file(1, size=100), _file(2, size=100), _file(3, size=200), _file(4, size=200)]
    criteria = {**BASE_CRITERIA, "use_size": True}

    groups = scope_extraction_groups(files, criteria)

    assert sorted(sorted(f["id"] for f in g) for g in groups) == [[1, 2], [3, 4]]
