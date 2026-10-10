import pytest

from app.services.splice import (
    StreamFacts,
    build_chapters_ffmetadata,
    build_concat_list,
    build_copy_cmd,
    build_reencode_cmd,
    duration_ok,
    mismatch_reasons,
    parse_probe,
    pick_output_ext,
    software_encoder,
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


def test_copy_cmd_without_chapters():
    cmd = build_copy_cmd("/t/list.txt", "/t/out.mp4", None)
    assert cmd[:6] == ["ffmpeg", "-y", "-f", "concat", "-safe", "0"]
    assert cmd[cmd.index("-i") + 1] == "/t/list.txt"
    assert "-c" in cmd and cmd[cmd.index("-c") + 1] == "copy"
    assert "-map_chapters" not in cmd
    assert cmd[-1] == "/t/out.mp4"


def test_copy_cmd_with_chapters_adds_second_input_and_maps_chapters():
    cmd = build_copy_cmd("/t/list.txt", "/t/out.mkv", "/t/meta.txt")
    assert cmd.count("-i") == 2
    assert cmd[cmd.index("-map_chapters") + 1] == "1"


def test_reencode_cmd_filtergraph_scales_pads_even_and_silences_missing_audio():
    ref = _facts(width=1920, height=1080, fps=24.0)
    portrait = _facts(path="/lib/p.mp4", width=1080, height=1920)
    silent = _facts(path="/lib/s.mp4", acodec=None, sample_rate=None, channels=None)
    cmd = build_reencode_cmd(
        [ref, portrait, silent], ref, "/t/out.mp4", "h264", 23, "medium", None, None
    )
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert graph.count("scale=1920:1080:force_original_aspect_ratio=decrease") == 3
    assert graph.count("pad=1920:1080:(ow-iw)/2:(oh-ih)/2") == 3
    assert "fps=24" in graph
    assert "anullsrc" in graph and "atrim=duration=10" in graph  # only the silent one
    assert "concat=n=3:v=1:a=1[v][a]" in graph
    assert cmd.count("-i") == 3
    assert cmd[cmd.index("-map") + 1] == "[v]"


def test_reencode_cmd_rounds_odd_reference_dimensions_down_to_even():
    ref = _facts(width=1279, height=719)
    cmd = build_reencode_cmd([ref, ref], ref, "/t/o.mkv", "h264", 23, "fast", None, None)
    assert "scale=1278:718" in cmd[cmd.index("-filter_complex") + 1]


def test_reencode_cmd_no_audio_anywhere_has_no_audio_map():
    ref = _facts(acodec=None, sample_rate=None, channels=None)
    cmd = build_reencode_cmd([ref, ref], ref, "/t/o.mkv", "h264", 23, "fast", None, None)
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "concat=n=2:v=1:a=0[v]" in graph and "[a]" not in graph
    assert "[a]" not in cmd


def test_reencode_encoder_override_is_used():
    ref = _facts()
    cmd = build_reencode_cmd(
        [ref, ref], ref, "/t/o.mp4", "h264", 23, "medium", None, None, encoder="libx264"
    )
    assert cmd[cmd.index("-c:v") + 1] == "libx264"


def test_software_encoder_names():
    assert [software_encoder(c) for c in ("h264", "hevc", "av1")] == [
        "libx264",
        "libx265",
        "libsvtav1",
    ]


def test_reencode_hevc_mp4_gets_hvc1_tag():
    ref = _facts()
    cmd = build_reencode_cmd([ref, ref], ref, "/t/o.mp4", "hevc", 28, "medium", None, None)
    assert cmd[cmd.index("-tag:v") + 1] == "hvc1"


@pytest.mark.parametrize(
    "verdict,first_ext,codec,expected",
    [
        ("copy", ".MP4", None, ".mp4"),
        ("copy", ".mkv", None, ".mkv"),
        ("reencode", ".mp4", "h264", ".mp4"),
        ("reencode", ".m4v", "hevc", ".mp4"),
        ("reencode", ".mkv", "h264", ".mkv"),
        ("reencode", ".webm", "h264", ".mkv"),
        ("reencode", ".mp4", "av1", ".mkv"),
    ],
)
def test_pick_output_ext(verdict, first_ext, codec, expected):
    assert pick_output_ext(verdict, first_ext, codec) == expected


def test_parse_probe_reads_display_matrix_and_legacy_rotate_tag():
    base = {"codec_type": "video", "width": 320, "height": 180}
    matrix = {**base, "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}]}
    legacy = {**base, "tags": {"rotate": "270"}}
    assert parse_probe("/x.mp4", {"format": {}, "streams": [matrix]}).rotation == 90
    assert parse_probe("/x.mp4", {"format": {}, "streams": [legacy]}).rotation == 270
    assert parse_probe("/x.mp4", {"format": {}, "streams": [base]}).rotation == 0


def test_rotation_difference_forces_reencode():
    a, b = _facts(), _facts(path="/lib/b.mp4", rotation=90)
    assert any("rotation" in r for r in mismatch_reasons(a, b))
    assert verdict_for(a, [a, b]) == "reencode"


def test_reencode_swaps_target_size_for_a_rotated_reference():
    ref = _facts(width=320, height=180, rotation=90)  # displays as 180x320 portrait
    cmd = build_reencode_cmd([ref, ref], ref, "/t/o.mkv", "h264", 23, "fast", None, None)
    assert "scale=180:320" in cmd[cmd.index("-filter_complex") + 1]
