import os
import subprocess

import pytest

from app.services.gpu_pool import GPUDevice
from app.services.splice import SpliceCancelled, perform_merge, probe_facts


def _clip(path, size="320x240", audio=True):
    args = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=duration=1:size={size}:rate=25"]
    if audio:
        args += ["-f", "lavfi", "-i", "sine=duration=1:frequency=440:sample_rate=48000"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        args += ["-c:a", "aac", "-shortest"]
    subprocess.run([*args, str(path)], check=True, capture_output=True)


def _settings(name="joined", verdict="copy", reencode=None, chapters=True):
    return {
        "output_name": name,
        "chapters": chapters,
        "verdict": verdict,
        "reencode": reencode,
        "reference_index": 0,
    }


def _run(tmp_path, names, settings, cancel=lambda: False):
    paths = [str(tmp_path / n) for n in names]
    return perform_merge(list(range(1, len(paths) + 1)), paths, settings, lambda f: None, cancel)


def test_copy_merge_joins_moves_sources_and_names_output(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    out = _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert out == str(tmp_path / "joined.mp4")
    assert 1.8 < probe_facts(out).duration < 2.3
    assert probe_facts(out).has_audio
    assert not (tmp_path / "a.mp4").exists() and not (tmp_path / "b.mp4").exists()
    assert sorted(os.listdir(tmp_path / "_originals")) == ["a.mp4", "b.mp4"]
    assert [p for p in os.listdir(tmp_path) if p.startswith(".")] == []  # no temp left


def test_reencode_merge_mixed_resolution_and_missing_audio(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4", size="160x120", audio=False)
    s = _settings(
        verdict="reencode",
        reencode={"codec": "h264", "crf": 28, "speed": "fast", "reference_file_id": None},
    )
    out = _run(tmp_path, ["a.mp4", "b.mp4"], s)
    f = probe_facts(out)
    assert (f.width, f.height) == (320, 240)
    assert f.has_audio and 1.8 < f.duration < 2.4


def test_output_may_reuse_first_source_name(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    out = _run(tmp_path, ["a.mp4", "b.mp4"], _settings(name="a"))
    assert out == str(tmp_path / "a.mp4") and os.path.exists(out)
    assert os.path.exists(tmp_path / "_originals" / "a.mp4")


def test_originals_collision_gets_the_file_id_suffix(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    (tmp_path / "_originals").mkdir()
    (tmp_path / "_originals" / "a.mp4").write_bytes(b"old")
    (tmp_path / "_originals" / "a_7.mp4").write_bytes(b"older")
    paths = [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")]
    perform_merge([7, 8], paths, _settings(), lambda f: None, lambda: False)
    assert sorted(os.listdir(tmp_path / "_originals")) == [
        "a.mp4",
        "a_7.mp4",
        "a_7_1.mp4",
        "b.mp4",
    ]


def test_cancel_leaves_sources_and_no_temp(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    with pytest.raises(SpliceCancelled):
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings(), cancel=lambda: True)
    assert sorted(os.listdir(tmp_path)) == ["a.mp4", "b.mp4"]


def test_verify_failure_leaves_sources_untouched(tmp_path, monkeypatch):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    monkeypatch.setattr("app.services.splice.duration_ok", lambda a, e: False)
    with pytest.raises(RuntimeError, match="verif"):
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert sorted(os.listdir(tmp_path)) == ["a.mp4", "b.mp4"]


def test_second_move_failure_rolls_back_first(tmp_path, monkeypatch):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    import app.services.splice as sp

    real = sp.move_to_originals
    calls = {"n": 0}

    def flaky(path, file_id):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real(path, file_id)

    monkeypatch.setattr(sp, "move_to_originals", flaky)
    with pytest.raises(RuntimeError):
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert (tmp_path / "a.mp4").exists() and (tmp_path / "b.mp4").exists()
    assert [p for p in os.listdir(tmp_path) if p.startswith(".") or p == "joined.mp4"] == []


def _reencode_settings():
    return _settings(
        verdict="reencode",
        reencode={"codec": "h264", "crf": 28, "speed": "fast", "reference_file_id": None},
    )


def _two_mismatched_clips(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4", size="160x120")


def _fake_gpus(monkeypatch, devices):
    from app.services import gpu_pool

    monkeypatch.setattr(gpu_pool, "detect_gpus", lambda: devices)


_NVIDIA = GPUDevice(vendor="nvidia", index="0", label="RTX", family="nvenc")
_INTEL = GPUDevice(vendor="intel", index="/dev/dri/renderD128", label="iGPU", family="vaapi")


@pytest.mark.parametrize(
    "encoder,devices",
    [("h264_nvenc", [_NVIDIA]), ("h264_vaapi", [_INTEL]), ("h264_qsv", [])],
)
def test_any_hardware_encoder_failure_raises_marker_then_cpu_retry_succeeds(
    tmp_path, monkeypatch, encoder, devices
):
    import app.services.splice as sp

    _two_mismatched_clips(tmp_path)
    _fake_gpus(monkeypatch, devices)
    real = sp._run_ffmpeg

    def fake(cmd, total, progress_cb, is_cancelled):
        if encoder in cmd:
            raise RuntimeError("device init failed")  # stands in for a broken GPU
        return real(cmd, total, progress_cb, is_cancelled)

    monkeypatch.setattr(sp, "_resolve_encoder", lambda codec: encoder)
    monkeypatch.setattr(sp, "_run_ffmpeg", fake)
    with pytest.raises(sp.GpuEncodeFailed, match="GPU encode failed"):
        _run(tmp_path, ["a.mp4", "b.mp4"], _reencode_settings())
    assert sorted(os.listdir(tmp_path)) == ["a.mp4", "b.mp4"]  # untouched, no temp
    out = _run(tmp_path, ["a.mp4", "b.mp4"], {**_reencode_settings(), "force_cpu": True})
    assert os.path.exists(out) and probe_facts(out).vcodec == "h264"


def test_vaapi_without_a_vaapi_device_falls_back_to_software(tmp_path, monkeypatch):
    import app.services.splice as sp

    _two_mismatched_clips(tmp_path)
    _fake_gpus(monkeypatch, [])
    real = sp._run_ffmpeg
    seen = []

    def spy(cmd, total, progress_cb, is_cancelled):
        seen.append(cmd[cmd.index("-c:v") + 1])
        return real(cmd, total, progress_cb, is_cancelled)

    notes = []
    monkeypatch.setattr(sp, "_resolve_encoder", lambda codec: "h264_vaapi")
    monkeypatch.setattr(sp, "_run_ffmpeg", spy)
    out = sp.perform_merge(
        [1, 2],
        [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")],
        _reencode_settings(),
        lambda f: None,
        lambda: False,
        notes.append,
    )
    assert seen == ["libx264"] and os.path.exists(out)
    assert any("no vaapi device" in n.lower() for n in notes)


def test_concurrent_merge_to_the_same_output_name_is_refused(tmp_path):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    final = str(tmp_path / "joined.mp4")
    sp._RESERVED.add(final)  # another running merge already owns this name
    try:
        with pytest.raises(RuntimeError, match="in use"):
            _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    finally:
        sp._RESERVED.discard(final)
    assert sorted(os.listdir(tmp_path)) == ["a.mp4", "b.mp4"]


def test_reservation_is_released_after_success_and_failure(tmp_path, monkeypatch):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert sp._RESERVED == set()
    monkeypatch.setattr(sp, "duration_ok", lambda a, e: False)
    _clip(tmp_path / "c.mp4")
    _clip(tmp_path / "d.mp4")
    with pytest.raises(RuntimeError):
        _run(tmp_path, ["c.mp4", "d.mp4"], _settings(name="other"))
    assert sp._RESERVED == set()


def test_output_name_appearing_during_the_encode_is_not_overwritten(tmp_path, monkeypatch):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    real = sp._run_ffmpeg

    def run_then_squat(cmd, total, progress_cb, is_cancelled):
        real(cmd, total, progress_cb, is_cancelled)
        (tmp_path / "joined.mp4").write_bytes(b"someone else's output")

    monkeypatch.setattr(sp, "_run_ffmpeg", run_then_squat)
    with pytest.raises(RuntimeError, match="already exists"):
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert (tmp_path / "joined.mp4").read_bytes() == b"someone else's output"
    assert (tmp_path / "a.mp4").exists() and (tmp_path / "b.mp4").exists()


def test_source_with_apostrophe_and_spaces(tmp_path):
    _clip(tmp_path / "it's a clip.mp4")
    _clip(tmp_path / "ünï b.mp4")
    out = _run(tmp_path, ["it's a clip.mp4", "ünï b.mp4"], _settings())
    assert os.path.exists(out)


def test_failed_rollback_names_the_files_left_in_originals(tmp_path, monkeypatch):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    real_originals = sp.move_to_originals
    real_move = sp.shutil.move
    calls = {"n": 0}

    def flaky(path, file_id):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real_originals(path, file_id)

    def move(src, dst):
        if str(src).endswith("_originals/a.mp4"):
            raise OSError("cannot restore")  # the rollback of the first move
        return real_move(src, dst)

    monkeypatch.setattr(sp, "move_to_originals", flaky)
    monkeypatch.setattr(sp.shutil, "move", move)
    with pytest.raises(RuntimeError) as exc:
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert "_originals/a.mp4" in str(exc.value)  # the user is told where a.mp4 is stuck


def test_failed_final_move_leaves_no_partial_output_and_restores_sources(tmp_path, monkeypatch):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    final = str(tmp_path / "joined.mp4")
    real_move = sp.shutil.move

    def move(src, dst):
        if str(dst) == final:
            with open(dst, "wb") as fh:
                fh.write(b"partial")
            raise OSError("no space left")
        return real_move(src, dst)

    monkeypatch.setattr(sp.shutil, "move", move)
    with pytest.raises(RuntimeError):
        _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert sorted(os.listdir(tmp_path)) == ["_originals", "a.mp4", "b.mp4"]
    assert os.listdir(tmp_path / "_originals") == []
