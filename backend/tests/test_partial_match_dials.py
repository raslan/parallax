import numpy as np

from app.services.partial_match import Fingerprint, match_pair
from tests.test_partial_match import _noisy, _random_frames


def test_the_cutoff_decides_whether_a_noisy_copy_still_counts():
    rng = np.random.default_rng(11)
    long_ = _random_frames(rng, 4000)
    # ~20% of bits differ: a rough copy.
    short = Fingerprint(_noisy(long_[500:1500].copy(), rng, 0.20))
    long_fp = Fingerprint(long_)

    assert match_pair(short, long_fp, max_ber=0.30).coverage_short > 0.9
    assert match_pair(short, long_fp, max_ber=0.10) is None


def test_min_stretch_ignores_short_scattered_snippets():
    rng = np.random.default_rng(12)
    long_ = _random_frames(rng, 6000)
    # Two ~5.5 s snippets of the long track, separated by audio that isn't in it. Matching
    # works in 5 s windows, so a stretch measures a second or two longer than it really is.
    short = Fingerprint(
        np.concatenate([long_[1000:1045], _random_frames(rng, 200), long_[3000:3045]])
    )
    long_fp = Fingerprint(long_)

    anything = match_pair(short, long_fp, min_stretch_s=0)
    assert anything is not None and 0.3 < anything.coverage_short < 0.6
    assert match_pair(short, long_fp, min_stretch_s=5) is not None
    assert match_pair(short, long_fp, min_stretch_s=12) is None


def test_a_clip_shorter_than_the_stretch_can_still_match_whole():
    rng = np.random.default_rng(13)
    long_ = _random_frames(rng, 6000)
    clip = Fingerprint(long_[2000:2060].copy())  # ~7 s, shorter than the 30 s asked for

    m = match_pair(clip, Fingerprint(long_), min_stretch_s=30)

    assert m is not None and m.coverage_short > 0.9
