import os
import subprocess

import pytest

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


def test_originals_collision_gets_id_suffix(tmp_path):
    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4")
    (tmp_path / "_originals").mkdir()
    (tmp_path / "_originals" / "a.mp4").write_bytes(b"old")
    _run(tmp_path, ["a.mp4", "b.mp4"], _settings())
    assert sorted(os.listdir(tmp_path / "_originals")) == ["a.mp4", "a_1.mp4", "b.mp4"]


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


def test_gpu_failure_raises_marker_then_cpu_retry_succeeds(tmp_path, monkeypatch):
    import app.services.splice as sp

    _clip(tmp_path / "a.mp4")
    _clip(tmp_path / "b.mp4", size="160x120")
    s = _settings(
        verdict="reencode",
        reencode={"codec": "h264", "crf": 28, "speed": "fast", "reference_file_id": None},
    )
    # h264_vaapi with no device fails in ffmpeg, standing in for a broken GPU
    monkeypatch.setattr(sp, "_resolve_encoder", lambda codec: "h264_vaapi")
    with pytest.raises(sp.GpuEncodeFailed):
        _run(tmp_path, ["a.mp4", "b.mp4"], s)
    assert sorted(os.listdir(tmp_path)) == ["a.mp4", "b.mp4"]  # untouched, no temp
    out = _run(tmp_path, ["a.mp4", "b.mp4"], {**s, "force_cpu": True})
    assert os.path.exists(out) and probe_facts(out).vcodec == "h264"


def test_source_with_apostrophe_and_spaces(tmp_path):
    _clip(tmp_path / "it's a clip.mp4")
    _clip(tmp_path / "ünï b.mp4")
    out = _run(tmp_path, ["it's a clip.mp4", "ünï b.mp4"], _settings())
    assert os.path.exists(out)
