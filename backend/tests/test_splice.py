import pytest

from app.services.splice import (
    StreamFacts,
    build_chapters_ffmetadata,
    build_concat_list,
    duration_ok,
    mismatch_reasons,
    parse_probe,
    validate_output_name,
    verdict_for,
)


def _facts(**kw) -> StreamFacts:
    base = dict(
        path="/lib/a.mp4",
        duration=10.0,
        vcodec="h264",
        width=1920,
        height=1080,
        fps=24.0,
        pix_fmt="yuv420p",
        acodec="aac",
        sample_rate=48000,
        channels=2,
    )
    base.update(kw)
    return StreamFacts(**base)


def test_parse_probe_extracts_main_streams_and_fps_fraction():
    data = {
        "format": {"duration": "12.5"},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "hevc",
                "width": 1280,
                "height": 720,
                "r_frame_rate": "30000/1001",
                "pix_fmt": "yuv420p10le",
            },
            {"codec_type": "audio", "codec_name": "opus", "sample_rate": "48000", "channels": 6},
            {"codec_type": "audio", "codec_name": "aac", "sample_rate": "44100", "channels": 2},
            {"codec_type": "subtitle", "codec_name": "subrip"},
        ],
    }
    f = parse_probe("/x/y.mkv", data)
    assert (f.vcodec, f.width, f.height, f.pix_fmt) == ("hevc", 1280, 720, "yuv420p10le")
    assert f.fps == pytest.approx(29.97, abs=0.01)
    assert (f.acodec, f.sample_rate, f.channels) == ("opus", 48000, 6)  # first audio only
    assert f.duration == 12.5 and f.has_audio


def test_parse_probe_no_audio():
    f = parse_probe("/x.mp4", {"format": {"duration": "1"}, "streams": [{"codec_type": "video"}]})
    assert not f.has_audio and f.acodec is None


def test_identical_facts_have_no_mismatch_and_verdict_copy():
    a, b = _facts(), _facts(path="/lib/b.mp4", duration=3.0)
    assert mismatch_reasons(a, b) == []
    assert verdict_for(a, [a, b]) == "copy"


@pytest.mark.parametrize(
    "override,fragment",
    [
        ({"vcodec": "hevc"}, "video codec"),
        ({"width": 1280, "height": 720}, "resolution"),
        ({"fps": 30.0}, "frame rate"),
        ({"pix_fmt": "yuv420p10le"}, "pixel format"),
        ({"acodec": "opus"}, "audio codec"),
        ({"sample_rate": 44100}, "sample rate"),
        ({"channels": 1}, "channels"),
        ({"acodec": None, "sample_rate": None, "channels": None}, "no audio"),
    ],
)
def test_each_difference_is_reported_and_forces_reencode(override, fragment):
    a, b = _facts(), _facts(path="/lib/b.mp4", **override)
    reasons = mismatch_reasons(a, b)
    assert any(fragment in r for r in reasons), reasons
    assert verdict_for(a, [a, b]) == "reencode"


def test_fps_within_tolerance_matches():
    assert mismatch_reasons(_facts(fps=23.976), _facts(fps=23.9760239)) == []


@pytest.mark.parametrize("bad", ["", "   ", "a/b", "a\\b", "..", ".hidden", "x" * 300, "a\x00b"])
def test_validate_output_name_rejects(bad):
    with pytest.raises(ValueError):
        validate_output_name(bad)


def test_validate_output_name_strips_and_keeps_unicode():
    assert validate_output_name("  Sommer – Zusammenschnitt  ") == "Sommer – Zusammenschnitt"


def test_concat_list_escapes_single_quotes_and_keeps_spaces_unicode():
    out = build_concat_list(["/lib/it's a clip.mp4", "/lib/ünï.mp4"])
    assert out.splitlines() == [
        r"file '/lib/it'\''s a clip.mp4'",
        "file '/lib/ünï.mp4'",
    ]


def test_chapters_have_cumulative_millisecond_ranges_and_escape_titles():
    meta = build_chapters_ffmetadata([("a=b;c", 10.0), ("two", 2.5)])
    assert meta.startswith(";FFMETADATA1\n")
    assert "START=0\nEND=10000\ntitle=a" + "\\=b\\;c" in meta
    assert "START=10000\nEND=12500\ntitle=two" in meta


def test_duration_ok_tolerance():
    assert duration_ok(100.0, 100.0)
    assert duration_ok(101.5, 100.0)  # within 2 s / 1 %
    assert not duration_ok(90.0, 100.0)
    assert not duration_ok(0.0, 5.0)
