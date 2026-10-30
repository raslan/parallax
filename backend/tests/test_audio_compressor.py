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


def test_already_at_target_covers_own_vbr_output():
    # Opus encoded at 128k measures a little over 128k; that is not worth re-encoding.
    assert ac.is_already_at_target("opus", 134_000, "opus", 128)
    assert ac.is_already_at_target("opus", 128_000, "opus", 128)
    assert not ac.is_already_at_target("opus", 175_000, "opus", 128)


def test_already_at_target_is_strict_across_codecs():
    # mp3 -> opus can still save space, so only the plain "at/below target" guard applies.
    assert not ac.is_already_at_target("mp3", 134_000, "opus", 128)
    assert ac.is_already_at_target("mp3", 128_000, "opus", 128)
    assert ac.is_already_at_target("mp3", 96_000, "opus", 128)


def test_already_at_target_unknown_bitrate_is_not_skipped():
    assert not ac.is_already_at_target("opus", None, "opus", 128)
    assert not ac.is_already_at_target(None, 0, "opus", 128)


def test_build_cmd_preserves_metadata_and_drops_video():
    cmd = ac._build_audio_cmd("/in.mp3", "/out.opus", "libopus", 96)
    s = " ".join(cmd)
    assert "-map_metadata 0" in s
    assert "-map_metadata:s:a 0" in s
    assert "-map_chapters 0" in s
    assert "-vn" in s
    assert "-b:a 96k" in s
    assert "-c:a libopus" in s
