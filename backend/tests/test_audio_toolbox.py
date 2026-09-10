import pytest

from app.services import audio_toolbox as tb

# ---- _encoder_for_source -------------------------------------------------------


@pytest.mark.parametrize(
    "codec, expect_encoder_options, expect_bitrate",
    [
        ("aac", {"libfdk_aac", "aac"}, "128k"),
        ("mp3", {"libmp3lame"}, "128k"),
        ("opus", {"libopus"}, "128k"),
        ("vorbis", {"libvorbis"}, "128k"),
        ("flac", {"flac"}, None),
        ("alac", {"alac"}, None),
        ("pcm_s16le", {"pcm_s16le"}, None),
        ("wmav2", {"libfdk_aac", "aac"}, "128k"),
        (None, {"libfdk_aac", "aac"}, "128k"),
    ],
)
def test_encoder_for_source(codec, expect_encoder_options, expect_bitrate):
    enc, bitrate = tb._encoder_for_source(codec, 128_000)
    assert enc in expect_encoder_options
    assert bitrate == expect_bitrate


def test_encoder_for_source_bitrate_fallbacks_when_unknown():
    # lossy source, no measured bitrate -> per-codec fallback
    assert tb._encoder_for_source("aac", None)[1] == "192k"
    assert tb._encoder_for_source("opus", None)[1] == "128k"
    assert tb._encoder_for_source("vorbis", None)[1] == "160k"
    assert tb._encoder_for_source(None, None)[1] == "192k"


def test_encoder_for_source_lossless_never_has_bitrate():
    assert tb._encoder_for_source("flac", 900_000)[1] is None


# ---- _parse_loudnorm_json ----------------------------------------------------

_FFMPEG_STDERR = """\
ffmpeg version 6.0 Copyright (c) 2000-2023
  built with gcc 12
Input #0, mp3, from 'in.mp3':
[Parsed_loudnorm_0 @ 0x55]
{
	"input_i" : "-27.61",
	"input_tp" : "-11.20",
	"input_lra" : "6.90",
	"input_thresh" : "-37.88",
	"output_i" : "-16.00",
	"target_offset" : "0.42"
}
"""


def test_parse_loudnorm_json_extracts_measured_values():
    m = tb._parse_loudnorm_json(_FFMPEG_STDERR)
    assert m["input_i"] == "-27.61"
    assert m["input_tp"] == "-11.20"
    assert m["input_lra"] == "6.90"
    assert m["input_thresh"] == "-37.88"
    assert m["target_offset"] == "0.42"


def test_parse_loudnorm_json_returns_none_without_block():
    assert tb._parse_loudnorm_json("no json here\njust progress\n") is None


# ---- _build_audio_toolbox_cmd ----------------------------------------------


def _cmd(**kw):
    base = dict(
        src="/in.mp3",
        out="/out.mp3",
        duration=100.0,
        trim_start=0.0,
        trim_end=0.0,
        channel_op=None,
        normalize=False,
        encoder="aac",
        bitrate_arg="128k",
        measured=None,
    )
    base.update(kw)
    return " ".join(
        tb._build_audio_toolbox_cmd(
            base["src"],
            base["out"],
            duration=base["duration"],
            trim_start=base["trim_start"],
            trim_end=base["trim_end"],
            channel_op=base["channel_op"],
            normalize=base["normalize"],
            encoder=base["encoder"],
            bitrate_arg=base["bitrate_arg"],
            measured=base["measured"],
        )
    )


def test_trim_only_stream_copies_audio():
    s = _cmd(trim_start=5.0, trim_end=10.0)
    assert "-c:a copy" in s
    assert "-af" not in s
    assert "-ss 5.0" in s
    assert "-t 85.0" in s  # 100 - 5 - 10


def test_no_ops_still_stream_copies():
    s = _cmd()
    assert "-c:a copy" in s


def test_normalize_uses_two_pass_measured_filter():
    measured = {
        "input_i": "-27.61",
        "input_tp": "-11.20",
        "input_lra": "6.90",
        "input_thresh": "-37.88",
        "target_offset": "0.42",
    }
    s = _cmd(normalize=True, measured=measured)
    assert "loudnorm=I=-16:TP=-1.5:LRA=11" in s
    assert "measured_I=-27.61" in s
    assert "measured_TP=-11.20" in s
    assert "measured_LRA=6.90" in s
    assert "measured_thresh=-37.88" in s
    assert "offset=0.42" in s
    assert "linear=true" in s
    assert "-c:a aac" in s
    assert "-b:a 128k" in s


def test_normalize_without_measured_falls_back_to_dynamic_pass():
    s = _cmd(normalize=True, measured=None)
    assert "loudnorm=I=-16:TP=-1.5:LRA=11" in s
    assert "measured_I" not in s


@pytest.mark.parametrize(
    "op, needle",
    [
        ("mono", "-ac 1"),
        ("downmix_stereo", "-ac 2"),
        ("left_to_both", "pan=stereo|c0=c0|c1=c0"),
        ("right_to_both", "pan=stereo|c0=c1|c1=c1"),
    ],
)
def test_channel_ops(op, needle):
    s = _cmd(channel_op=op)
    assert needle in s
    assert "-c:a copy" not in s  # channel change forces re-encode


def test_every_command_preserves_metadata_and_chapters():
    for kw in ({}, {"normalize": True}, {"channel_op": "mono"}, {"trim_start": 3.0}):
        s = _cmd(**kw)
        assert "-map_metadata 0" in s
        assert "-map_metadata:s:a 0" in s
        assert "-map_chapters 0" in s


def test_lossless_target_omits_bitrate_flag():
    s = _cmd(normalize=True, encoder="flac", bitrate_arg=None, measured=None)
    assert "-b:a" not in s
    assert "-c:a flac" in s


def test_progress_flags_present():
    s = _cmd()
    assert "-progress pipe:1" in s
    assert "-nostats" in s
