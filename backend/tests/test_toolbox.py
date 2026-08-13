import os
import subprocess

from app.services.encoder import encoder_for_codec
from app.services.toolbox import (
    _build_toolbox_cmd,
    parse_channel_rms,
    _parse_last_keyframe_at_or_before,
    _nearest_keyframe_at_or_before,
    _has_audio_stream,
    _toolbox_fix_one,
)


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
        source_codec="h264",
    )
    assert cmd[cmd.index("-c:v") + 1] == encoder_for_codec("h264")
    assert cmd[cmd.index("-vf") + 1] == "transpose=1"


def test_build_cmd_force_video_reencode_without_rotate():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=True,
    )
    assert cmd[cmd.index("-c:v") + 1] != "copy"
    assert cmd[cmd.index("-ss") + 1] == "3.0"
    assert cmd[cmd.index("-t") + 1] == "57.0"


def test_build_cmd_force_video_reencode_uses_source_codec():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        source_codec="hevc", force_video_reencode=True,
    )
    encoder = cmd[cmd.index("-c:v") + 1]
    assert encoder == encoder_for_codec("hevc")
    assert encoder != encoder_for_codec(None)


def test_build_cmd_no_force_reencode_keeps_copy():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=False,
    )
    assert cmd[cmd.index("-c:v") + 1] == "copy"


def test_build_cmd_force_video_reencode_default_is_false():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-c:v") + 1] == "copy"


def test_build_cmd_rotate_270_uses_transpose_2():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=270,
        normalize=False, faststart=False, sync_offset_ms=None,
        source_codec="h264",
    )
    assert cmd[cmd.index("-vf") + 1] == "transpose=2"


def test_build_cmd_rotate_180_double_transpose():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=180,
        normalize=False, faststart=False, sync_offset_ms=None,
        source_codec="h264",
    )
    assert cmd[cmd.index("-vf") + 1] == "transpose=1,transpose=1"


def test_build_cmd_rotate_hevc_source_uses_hevc_encoder():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=90,
        normalize=False, faststart=False, sync_offset_ms=None,
        source_codec="hevc",
    )
    assert cmd[cmd.index("-c:v") + 1] == encoder_for_codec("hevc")


def test_build_cmd_rotate_no_source_codec_defaults_to_h264_encoder():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=90,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert cmd[cmd.index("-c:v") + 1] == encoder_for_codec(None)


def test_build_cmd_rotate_maps_only_primary_video_stream():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=90,
        normalize=False, faststart=False, sync_offset_ms=None,
        source_codec="h264",
    )
    assert cmd[cmd.index("-map") + 1] == "0:v:0"


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
    assert cmd[cmd.index("-map") + 1] == "0:v:0"
    assert cmd[cmd.index("-map") + 3] == "1:a?"


def test_build_cmd_sync_offset_alone_keeps_audio_copy():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=250.0,
    )
    assert cmd[cmd.index("-c:a") + 1] == "copy"


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
    assert cmd[cmd.index("-map") + 1] == "0:v:0"
    assert cmd[cmd.index("-map") + 3] == "0:a?"


def test_build_cmd_maps_subtitles_and_chapters():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
    )
    assert "0:s?" in cmd
    assert cmd[cmd.index("-map_chapters") + 1] == "0"
    assert cmd[cmd.index("-c:s") + 1] == "copy"


def test_build_cmd_maps_subtitles_and_chapters_with_dual_input():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=250.0,
    )
    assert "0:s?" in cmd
    assert cmd[cmd.index("-map_chapters") + 1] == "0"
    assert cmd[cmd.index("-c:s") + 1] == "copy"


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


def test_parse_last_keyframe_finds_last_before_target():
    csv_output = (
        "0.000000,K_\n"
        "0.500000,__\n"
        "1.000000,__\n"
        "3.337000,K_\n"
        "3.500000,__\n"
        "7.841000,K_\n"
    )
    assert _parse_last_keyframe_at_or_before(csv_output, 3.5) == 3.337


def test_parse_last_keyframe_only_keyframe_at_zero():
    csv_output = (
        "0.000000,K_\n"
        "0.500000,__\n"
        "1.000000,__\n"
    )
    assert _parse_last_keyframe_at_or_before(csv_output, 1.0) == 0.0


def test_parse_last_keyframe_ignores_keyframes_after_target():
    csv_output = (
        "0.000000,K_\n"
        "5.000000,K_\n"
    )
    assert _parse_last_keyframe_at_or_before(csv_output, 2.0) == 0.0


def test_parse_last_keyframe_no_keyframe_data_returns_none():
    assert _parse_last_keyframe_at_or_before("", 3.0) is None


def test_nearest_keyframe_returns_none_when_ffprobe_missing(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()))
    assert _nearest_keyframe_at_or_before("/lib/movie.mp4", 5.0) is None


def test_nearest_keyframe_returns_none_on_timeout(monkeypatch):
    def raise_timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=30)
    monkeypatch.setattr(subprocess, "run", raise_timeout)
    assert _nearest_keyframe_at_or_before("/lib/movie.mp4", 5.0) is None


def test_nearest_keyframe_returns_none_on_garbage_output(monkeypatch):
    class FakeProc:
        stdout = "not,valid,csv\ngarbage\n"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeProc())
    assert _nearest_keyframe_at_or_before("/lib/movie.mp4", 5.0) is None


class _EmptyReadline:
    """Stand-in for a Popen.stdout pipe: readline() immediately signals EOF."""

    def readline(self):
        return ""


class _FakePopen:
    """Stand-in for subprocess.Popen that records the ffmpeg argv and reports
    instant success, so _toolbox_fix_one's decision logic can be exercised
    without actually invoking ffmpeg."""

    last_cmd: list[str] | None = None

    def __init__(self, cmd, stdout=None, stderr=None, text=None):
        _FakePopen.last_cmd = cmd
        self.stdout = _EmptyReadline()
        self.returncode = 0
        with open(cmd[-1], "wb") as f:
            f.write(b"fake output")

    def wait(self):
        return 0

    def kill(self):
        pass


def _patch_ffprobe_duration(monkeypatch, duration: float):
    real_run = subprocess.run

    def fake_run(cmd, *a, **k):
        if cmd[0] == "ffprobe" and "format=duration" in cmd:
            class FakeProc:
                stdout = f"{duration}\n"
            return FakeProc()
        return real_run(cmd, *a, **k)

    monkeypatch.setattr(subprocess, "run", fake_run)


def test_toolbox_fix_one_force_reencode_when_keyframe_far(monkeypatch, tmp_path):
    src = tmp_path / "movie.mp4"
    src.write_bytes(b"fake")
    _patch_ffprobe_duration(monkeypatch, 60.0)
    monkeypatch.setattr(
        "app.services.toolbox._nearest_keyframe_at_or_before", lambda path, target: 0.0
    )
    monkeypatch.setattr(subprocess, "Popen", _FakePopen)

    notes = []
    ok, err, final_path = _toolbox_fix_one(
        str(src), {"trim_start": 3.0}, job_id=1, note_cb=notes.append,
    )
    assert ok is True
    assert final_path == str(src)
    assert _FakePopen.last_cmd[_FakePopen.last_cmd.index("-c:v") + 1] != "copy"
    assert any("re-encoding video" in n for n in notes)


def test_toolbox_fix_one_keeps_copy_when_keyframe_near(monkeypatch, tmp_path):
    src = tmp_path / "movie.mp4"
    src.write_bytes(b"fake")
    _patch_ffprobe_duration(monkeypatch, 60.0)
    monkeypatch.setattr(
        "app.services.toolbox._nearest_keyframe_at_or_before", lambda path, target: 2.9
    )
    monkeypatch.setattr(subprocess, "Popen", _FakePopen)

    notes = []
    ok, err, final_path = _toolbox_fix_one(
        str(src), {"trim_start": 3.0}, job_id=1, note_cb=notes.append,
    )
    assert ok is True
    assert final_path == str(src)
    assert _FakePopen.last_cmd[_FakePopen.last_cmd.index("-c:v") + 1] == "copy"
    assert notes == []


def test_toolbox_fix_one_remuxes_webm_to_mkv_on_forced_reencode(monkeypatch, tmp_path):
    src = tmp_path / "movie.webm"
    src.write_bytes(b"fake")
    _patch_ffprobe_duration(monkeypatch, 60.0)
    monkeypatch.setattr(
        "app.services.toolbox._nearest_keyframe_at_or_before", lambda path, target: 0.0
    )
    monkeypatch.setattr("app.services.toolbox._has_audio_stream", lambda path: True)
    monkeypatch.setattr(subprocess, "Popen", _FakePopen)

    ok, err, final_path = _toolbox_fix_one(str(src), {"trim_start": 3.0}, job_id=1)

    assert ok is True
    expected_dst = str(tmp_path / "movie.mkv")
    assert final_path == expected_dst
    assert _FakePopen.last_cmd[-1] == str(tmp_path / "movie.fixing.mkv")
    assert _FakePopen.last_cmd[_FakePopen.last_cmd.index("-c:v") + 1] != "copy"
    vf = _FakePopen.last_cmd[_FakePopen.last_cmd.index("-vf") + 1]
    assert "setpts=PTS-STARTPTS" in vf
    assert _FakePopen.last_cmd[_FakePopen.last_cmd.index("-c:a") + 1] == "aac"
    af = _FakePopen.last_cmd[_FakePopen.last_cmd.index("-af") + 1]
    assert "asetpts=PTS-STARTPTS" in af
    assert os.path.exists(expected_dst)


def test_toolbox_fix_one_remux_without_audio_keeps_audio_copy(monkeypatch, tmp_path):
    src = tmp_path / "movie.webm"
    src.write_bytes(b"fake")
    _patch_ffprobe_duration(monkeypatch, 60.0)
    monkeypatch.setattr(
        "app.services.toolbox._nearest_keyframe_at_or_before", lambda path, target: 0.0
    )
    monkeypatch.setattr("app.services.toolbox._has_audio_stream", lambda path: False)
    monkeypatch.setattr(subprocess, "Popen", _FakePopen)

    ok, err, final_path = _toolbox_fix_one(str(src), {"trim_start": 3.0}, job_id=1)

    assert ok is True
    assert _FakePopen.last_cmd[_FakePopen.last_cmd.index("-c:a") + 1] == "copy"
    assert "-af" not in _FakePopen.last_cmd


def test_build_cmd_copy_mode_uses_keyframe_snapped_seek_for_clip_len():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=100.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        copy_seek_start=2.9,
    )
    assert cmd[cmd.index("-c:v") + 1] == "copy"
    assert cmd[cmd.index("-t") + 1] == "97.1"


def test_build_cmd_force_reencode_ignores_copy_seek_start_for_clip_len():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=100.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=True, copy_seek_start=0.0,
    )
    assert cmd[cmd.index("-t") + 1] == "97.0"


def test_build_cmd_rebase_pts_adds_setpts_and_forces_audio_reencode():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mkv", "/lib/movie.fixing.mkv", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=True, rebase_pts=True, has_audio=True,
    )
    assert "setpts=PTS-STARTPTS" in cmd[cmd.index("-vf") + 1]
    assert "asetpts=PTS-STARTPTS" in cmd[cmd.index("-af") + 1]
    assert cmd[cmd.index("-c:a") + 1] == "aac"


def test_build_cmd_rebase_pts_without_audio_keeps_copy_and_no_af():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mkv", "/lib/movie.fixing.mkv", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=True, rebase_pts=True, has_audio=False,
    )
    assert "setpts=PTS-STARTPTS" in cmd[cmd.index("-vf") + 1]
    assert "-af" not in cmd
    assert cmd[cmd.index("-c:a") + 1] == "copy"


def test_build_cmd_no_rebase_pts_no_setpts():
    cmd = _build_toolbox_cmd(
        "/lib/movie.mp4", "/lib/movie.fixing.mp4", duration=60.0,
        trim_start=3.0, trim_end=0, audio_channel=None, rotate_deg=None,
        normalize=False, faststart=False, sync_offset_ms=None,
        force_video_reencode=True,
    )
    assert "-vf" not in cmd


def test_has_audio_stream_true_when_ffprobe_reports_stream(monkeypatch):
    class FakeProc:
        stdout = "0\n"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeProc())
    assert _has_audio_stream("/lib/movie.mkv") is True


def test_has_audio_stream_false_when_ffprobe_reports_nothing(monkeypatch):
    class FakeProc:
        stdout = ""
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeProc())
    assert _has_audio_stream("/lib/movie.mkv") is False


def test_has_audio_stream_fails_safe_true_on_probe_error(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()))
    assert _has_audio_stream("/lib/movie.mkv") is True


def test_parse_last_keyframe_malformed_lines_are_skipped():
    csv_output = (
        "not,valid,csv,too,many,fields\n"
        "0.000000,K_\n"
        "garbage\n"
        "abc,K_\n"
        "2.000000,K_\n"
    )
    assert _parse_last_keyframe_at_or_before(csv_output, 2.0) == 2.0
