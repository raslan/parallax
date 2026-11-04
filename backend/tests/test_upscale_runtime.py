import subprocess

import numpy as np
import pytest

from app.services import upscale_runtime as rt
from app.services.upscale_models import get_tier


@pytest.fixture(autouse=True)
def _reset_probe(monkeypatch):
    monkeypatch.setattr(rt, "_probe_done", False)
    monkeypatch.setattr(rt, "_probe_index", None)


def _tile(value=0.5):
    return np.full((3, 4, 4), value, dtype=np.float32)


def test_run_with_fallback_uses_primary():
    calls = []

    def fallback(t):
        calls.append(1)
        return t

    out = rt.run_with_fallback(lambda t: t * 2, fallback, _tile())
    assert np.allclose(out, 1.0)
    assert not calls


def test_run_with_fallback_nan_uses_fallback():
    bad = lambda t: np.full_like(t, np.nan)  # noqa: E731
    out = rt.run_with_fallback(bad, lambda t: t + 1, _tile())
    assert np.allclose(out, 1.5)


def test_run_with_fallback_both_nan_raises():
    bad = lambda t: np.full_like(t, np.nan)  # noqa: E731
    with pytest.raises(RuntimeError, match="NaN"):
        rt.run_with_fallback(bad, bad, _tile())


def test_choose_device_force_cpu_never_probes(monkeypatch):
    def boom():
        raise AssertionError("probed")

    monkeypatch.setattr(rt, "gpu_available", boom)
    assert rt.choose_device(True) == "cpu"


def test_choose_device_no_gpu(monkeypatch):
    monkeypatch.setattr(rt, "gpu_available", lambda: False)
    assert rt.choose_device(False) == "cpu"


def test_choose_device_gpu(monkeypatch):
    monkeypatch.setattr(rt, "gpu_available", lambda: True)
    assert rt.choose_device(False) == "gpu"


def test_gpu_probe_failure_is_false_and_cached(monkeypatch):
    calls = []

    def fake_run(*a, **k):
        calls.append(1)
        raise subprocess.TimeoutExpired("probe", 10)

    monkeypatch.setattr(rt.subprocess, "run", fake_run)
    assert rt.gpu_available() is False
    assert rt.gpu_available() is False
    assert len(calls) == 1


def test_parse_probe_prefers_discrete_and_ignores_software():
    devices = [
        {"index": 0, "type": 3, "name": "llvmpipe"},
        {"index": 1, "type": 1, "name": "Intel"},
        {"index": 2, "type": 0, "name": "NVIDIA"},
    ]
    assert rt.pick_device_index(devices) == 2
    assert rt.pick_device_index([{"index": 0, "type": 3, "name": "llvmpipe"}]) is None
    assert rt.pick_device_index([]) is None


def test_probe_ignores_integrated():
    # Measured on an Intel UHD 630: ~1.75x slower than the 8-thread CPU, so Auto skips it.
    assert rt.pick_device_index([{"index": 0, "type": 1, "name": "Intel"}]) is None


def test_gpu_probe_garbage_output_is_false(monkeypatch):
    monkeypatch.setattr(
        rt.subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="not json", stderr=""),
    )
    assert rt.gpu_available() is False


def test_real_tile_shape_cpu():
    pytest.importorskip("ncnn")
    from app.services import _image_upscaler_impl as impl

    tier = get_tier("simple")
    rng = np.random.default_rng(0)
    tile = rng.random((3, 224, 224), dtype=np.float32) * 0.5 + 0.25
    out = impl.run_tile(tier.param_path, tier.bin_path, "cpu", tile)
    assert out.shape == (3, 448, 448)
    assert np.isfinite(out).all()
    assert abs(float(out.mean()) - float(tile.mean())) < 0.25


def test_run_tile_forwards_the_tiers_blob_names_to_the_worker(monkeypatch):
    seen = {}

    def fake_submit(fn, *args):
        seen["args"] = args
        return np.zeros((3, 8, 8), dtype=np.float32)

    monkeypatch.setattr(rt._pool, "submit", fake_submit)
    tier = get_tier("natural")
    rt.run_tile(tier, "cpu", _tile())
    assert seen["args"][-2:] == ("data", "output")


def test_real_natural_model_runs_with_its_own_blob_names():
    pytest.importorskip("ncnn")
    from app.services import _image_upscaler_impl as impl

    tier = get_tier("natural")
    assert tier.scale == 4
    rng = np.random.default_rng(1)
    tile = rng.random((3, 32, 32), dtype=np.float32) * 0.5 + 0.25  # fully convolutional: any size
    out = impl.run_tile(
        tier.param_path, tier.bin_path, "cpu", tile, 0, tier.input_blob, tier.output_blob
    )
    assert out.shape == (3, 128, 128)
    assert np.isfinite(out).all()
    assert abs(float(out.mean()) - float(tile.mean())) < 0.25


def test_probe_logs_why_vulkan_found_nothing(monkeypatch, caplog):
    import logging

    out = subprocess.CompletedProcess([], 0, stdout="[]\n", stderr="vkCreateInstance failed -9\n")
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: out)
    with caplog.at_level(logging.WARNING, logger=rt.logger.name):
        assert rt.gpu_available() is False
    assert "vkCreateInstance failed -9" in caplog.text
