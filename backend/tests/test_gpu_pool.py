import subprocess

import pytest

from app.services import gpu_pool as gp


@pytest.fixture(autouse=True)
def _reset_gpu_cache():
    gp._gpus = None
    yield
    gp._gpus = None


def test_detect_nvidia_parses_csv(monkeypatch):
    def fake_run(cmd, **kwargs):
        assert cmd[0] == "nvidia-smi"
        return subprocess.CompletedProcess(
            cmd, 0, stdout="0, NVIDIA GeForce RTX 5060 Ti\n1, NVIDIA GeForce RTX 5060 Ti\n"
        )

    monkeypatch.setattr(gp.subprocess, "run", fake_run)
    monkeypatch.setattr(gp, "_detect_vaapi", lambda: [])

    devices = gp.detect_gpus()

    assert [d.vendor for d in devices] == ["nvidia", "nvidia"]
    assert [d.index for d in devices] == ["0", "1"]
    assert devices[0].label == "NVIDIA GeForce RTX 5060 Ti"
    assert devices[0].family == "nvenc"


def test_detect_nvidia_smi_missing_returns_empty(monkeypatch):
    def fake_run(cmd, **kwargs):
        raise FileNotFoundError("nvidia-smi not found")

    monkeypatch.setattr(gp.subprocess, "run", fake_run)
    monkeypatch.setattr(gp, "_detect_vaapi", lambda: [])

    assert gp.detect_gpus() == []


def test_detect_vaapi_filters_unreadable_nodes(monkeypatch, tmp_path):
    readable = tmp_path / "renderD128"
    readable.write_text("")
    monkeypatch.setattr(gp.glob, "glob", lambda pattern: [str(readable), "/dev/dri/renderD129"])
    monkeypatch.setattr(gp.os, "access", lambda path, mode: path == str(readable))
    monkeypatch.setattr(gp, "_read_pci_vendor", lambda path: "0x1002")
    monkeypatch.setattr(gp, "_detect_nvidia", lambda: [])

    devices = gp.detect_gpus()

    assert len(devices) == 1
    assert devices[0].index == str(readable)
    assert devices[0].vendor == "amd"
    assert devices[0].family == "vaapi"


def test_detect_vaapi_unknown_vendor_still_included(monkeypatch, tmp_path):
    node = tmp_path / "renderD128"
    node.write_text("")
    monkeypatch.setattr(gp.glob, "glob", lambda pattern: [str(node)])
    monkeypatch.setattr(gp.os, "access", lambda path, mode: True)
    monkeypatch.setattr(gp, "_read_pci_vendor", lambda path: None)
    monkeypatch.setattr(gp, "_detect_nvidia", lambda: [])

    devices = gp.detect_gpus()

    assert devices[0].vendor == "unknown"
    assert devices[0].family == "vaapi"


def test_is_hwaccel_failure_matches_known_patterns():
    assert gp.is_hwaccel_failure("Error initializing CUDA device: no CUDA-capable device")
    assert gp.is_hwaccel_failure("[vaapi] vaInitialize failed with error code -1")
    assert not gp.is_hwaccel_failure("")
    assert not gp.is_hwaccel_failure("Error: Invalid argument -crf for encoder libx264")
