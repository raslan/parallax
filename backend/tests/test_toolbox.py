from app.services.toolbox import _build_toolbox_cmd, parse_channel_rms


def test_build_cmd_plain_copy_no_fixes():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=120.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-c:v") + 1] == "copy"
    assert cmd[cmd.index("-c:a") + 1] == "copy"
    assert "-ss" not in cmd
    assert "-t" not in cmd


def test_build_cmd_trim_both_ends():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=100.0,
        trim_start=5.0, trim_end=10.0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-ss") + 1] == "5.0"
    assert cmd[cmd.index("-t") + 1] == "85.0"


def test_build_cmd_trim_clip_len_is_plain_subtraction_no_floor():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=100.0,
        trim_start=5.0, trim_end=10.0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-t") + 1] == "85.0"


def test_build_cmd_rotate_forces_video_reencode():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=90,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert cmd[cmd.index("-vf") + 1] == "transpose=1"


def test_build_cmd_rotate_270_uses_transpose_2():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=270,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-vf") + 1] == "transpose=2"


def test_build_cmd_rotate_180_double_transpose():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=180,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-vf") + 1] == "transpose=1,transpose=1"


def test_build_cmd_audio_channel_left_forces_audio_reencode():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel="left", rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-af") + 1] == "pan=stereo|c0=c0|c1=c0"
    assert cmd[cmd.index("-c:a") + 1] == "aac"
    assert cmd[cmd.index("-c:v") + 1] == "copy"


def test_build_cmd_audio_channel_right():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel="right", rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-af") + 1] == "pan=stereo|c0=c1|c1=c1"


def test_build_cmd_normalize_chains_after_pan():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel="right", rotate_deg=None,
        normalize=True, faststart=False, sync_offset_ms=None,
    )
    af = cmd[cmd.index("-af") + 1]
    assert af == "pan=stereo|c0=c1|c1=c1,loudnorm=I=-16:TP=-1.5:LRA=11"


def test_build_cmd_normalize_alone():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=True, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-af") + 1] == "loudnorm=I=-16:TP=-1.5:LRA=11"
    assert cmd[cmd.index("-c:a") + 1] == "aac"


def test_build_cmd_faststart_only_for_mp4_like():
    cmd_mp4 = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=True, sync_offset_ms=None,
    )
    assert "-movflags" in cmd_mp4

    cmd_mkv = _build_toolbox_cmd(
        "/lib/movie.mkv", "/lib/movie.fixing.mkv", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=True, sync_offset_ms=None,
    )
    assert "-movflags" not in cmd_mkv


def test_build_cmd_sync_offset_uses_dual_input():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=250.0,
    )
    assert cmd.count("-i") == 2
    assert cmd[cmd.index("-itsoffset") + 1] == "0.25"
    assert cmd[cmd.index("-map") + 1] == "0:v"
    assert cmd[cmd.index("-map") + 3] == "1:a?"


def test_build_cmd_trim_applies_ss_to_both_inputs_with_sync_offset():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=5.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=100.0,
    )
    assert cmd.count("-ss") == 2


def test_build_cmd_no_sync_offset_uses_single_input():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd.count("-i") == 1
    assert cmd[cmd.index("-map") + 1] == "0:v"
    assert cmd[cmd.index("-map") + 3] == "0:a?"


def test_parse_channel_rms_two_channels():
    astats_output = """
[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] RMS level dB: -14.235
[Parsed_astats_0 @ 0x1] Channel: 2
[Parsed_astats_0 @ 0x1] RMS level dB: -48.902
"""
    rms = parse_channel_rms(astats_output)
    assert rms[1] == -14.235
    assert rms[2] == -48.902


def test_parse_channel_rms_handles_silent_channel():
    astats_output = """
Channel: 1
RMS level dB: -10.0
Channel: 2
RMS level dB: -inf
"""
    rms = parse_channel_rms(astats_output)
    assert rms[2] == float("-inf")
