import pytest

from app.services import audio_compressor as ac


def test_estimate_scales_linearly_with_bitrate():
    a = ac.estimate_audio_size(300.0, 128)
    b = ac.estimate_audio_size(300.0, 256)
    assert b == pytest.approx(a * 2, rel=0.01)


def test_estimate_zero_duration_is_zero():
    assert ac.estimate_audio_size(None, 128) == 0
    assert ac.estimate_audio_size(0, 128) == 0


def test_estimate_matches_bitrate_times_duration_within_overhead():
    # 128 kbps * 600 s = 9_600_000 bytes before overhead
    est = ac.estimate_audio_size(600.0, 128)
    assert 9_600_000 <= est <= 9_600_000 * 1.05


def test_savings_pct_never_negative():
    assert ac.audio_savings_pct(1000, 1500) == 0.0
    assert ac.audio_savings_pct(1000, 500) == 50.0
    assert ac.audio_savings_pct(0, 500) == 0.0


def test_build_cmd_preserves_metadata_and_drops_video():
    cmd = ac._build_audio_cmd("/in.mp3", "/out.opus", "libopus", 96)
    s = " ".join(cmd)
    assert "-map_metadata 0" in s
    assert "-map_metadata:s:a 0" in s
    assert "-map_chapters 0" in s
    assert "-vn" in s
    assert "-b:a 96k" in s
    assert "-c:a libopus" in s
