import subprocess
import threading
import time

import pytest

from app.services import gpu_pool as gp
from app.services.encoder import family_for_encoder
from app.services.gpu_pool import GPUDevice, GpuPool


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


def test_detect_gpus_does_not_double_count_nvidia_card_as_vaapi(monkeypatch, tmp_path):
    # nvidia-container-toolkit's "video" capability exposes an NVIDIA card's
    # own VA-API render node — without the vendor-id skip, the same physical
    # card would show up twice: once via nvidia-smi, once via /dev/dri.
    node = tmp_path / "renderD129"
    node.write_text("")
    monkeypatch.setattr(gp.glob, "glob", lambda pattern: [str(node)])
    monkeypatch.setattr(gp.os, "access", lambda path, mode: True)
    monkeypatch.setattr(gp, "_read_pci_vendor", lambda path: "0x10de")
    monkeypatch.setattr(
        gp,
        "_detect_nvidia",
        lambda: [gp.GPUDevice(vendor="nvidia", index="0", label="RTX 3050", family="nvenc")],
    )

    devices = gp.detect_gpus()

    assert len(devices) == 1
    assert devices[0].vendor == "nvidia"
    assert devices[0].family == "nvenc"


def test_is_hwaccel_failure_matches_known_patterns():
    assert gp.is_hwaccel_failure("Error initializing CUDA device: no CUDA-capable device")
    assert gp.is_hwaccel_failure("[vaapi] vaInitialize failed with error code -1")
    assert not gp.is_hwaccel_failure("")
    assert not gp.is_hwaccel_failure("Error: Invalid argument -crf for encoder libx264")


def test_family_for_encoder_known_and_unknown():
    assert family_for_encoder("hevc_nvenc") == "nvenc"
    assert family_for_encoder("hevc_vaapi") == "vaapi"
    assert family_for_encoder("libx265") == "software"
    assert family_for_encoder("something_made_up") == "software"


def _dev(index: str) -> GPUDevice:
    return GPUDevice(vendor="nvidia", index=index, label=f"card{index}", family="nvenc")


def test_gpu_pool_round_robins_across_devices():
    devices = [_dev("0"), _dev("1")]
    pool = GpuPool(devices, capacity=1)

    first = pool.acquire_any()
    second = pool.acquire_any()

    assert first is not None and second is not None
    assert {first.index, second.index} == {"0", "1"}


def test_gpu_pool_empty_devices_returns_none_immediately():
    pool = GpuPool([], capacity=3)
    assert pool.acquire_any(timeout=0.1) is None


def test_gpu_pool_degraded_device_excluded():
    devices = [_dev("0"), _dev("1")]
    pool = GpuPool(devices, capacity=1)

    bad = pool.acquire_any()
    assert bad is not None
    pool.mark_degraded(bad)
    pool.release(bad)

    good = pool.acquire_any(timeout=0.5)
    assert good is not None
    assert good.index != bad.index


def test_gpu_pool_all_degraded_returns_none():
    devices = [_dev("0")]
    pool = GpuPool(devices, capacity=1)
    pool.mark_degraded(devices[0])
    assert pool.acquire_any(timeout=0.1) is None


def test_gpu_pool_release_frees_slot_for_next_acquire():
    devices = [_dev("0")]
    pool = GpuPool(devices, capacity=1)

    held = pool.acquire_any()
    assert held is not None
    assert pool.acquire_any(timeout=0.1) is None  # capacity exhausted

    pool.release(held)
    assert pool.acquire_any(timeout=0.5) is not None


def test_gpu_pool_acquire_any_blocks_until_release():
    devices = [_dev("0")]
    pool = GpuPool(devices, capacity=1)
    held = pool.acquire_any()
    assert held is not None

    result = {}

    def waiter():
        result["device"] = pool.acquire_any()

    t = threading.Thread(target=waiter)
    t.start()
    time.sleep(0.1)
    assert "device" not in result  # still blocked
    pool.release(held)
    t.join(timeout=2)
    assert result["device"] is not None


def test_gpu_pool_build_filters_by_family_and_uses_passed_capacity(monkeypatch):
    import app.services.gpu_pool as gp2

    nvidia = GPUDevice(vendor="nvidia", index="0", label="card0", family="nvenc")
    amd = GPUDevice(vendor="amd", index="/dev/dri/renderD128", label="renderD128", family="vaapi")
    monkeypatch.setattr(gp2, "detect_gpus", lambda: [nvidia, amd])

    pool = GpuPool.build("nvenc", capacity=5)

    assert pool._devices == [nvidia]
    assert pool._capacity == 5


def test_gpu_pool_prefers_least_loaded_device_over_fixed_order():
    # Regression test: acquire_any must treat all devices as peers and route
    # to whichever has the most free capacity, not always prefer device 0
    # until it's completely full ("fill-then-spill", the old behavior that
    # left a second GPU idle at low concurrency settings).
    devices = [_dev("0"), _dev("1")]
    pool = GpuPool(devices, capacity=3)

    # Force two acquisitions onto device 0 only (device 1 excluded).
    pool.acquire_any(exclude=frozenset({"1"}))
    pool.acquire_any(exclude=frozenset({"1"}))

    # Device 0 now has 2 active (room for 1 more under capacity=3), device 1
    # has 0 active. An unrestricted acquire must prefer the least-loaded
    # device (1), not device 0 just because it comes first.
    got = pool.acquire_any()
    assert got is not None
    assert got.index == "1"


def test_gpu_pool_active_count_decreases_on_release():
    devices = [_dev("0")]
    pool = GpuPool(devices, capacity=2)

    a = pool.acquire_any()
    b = pool.acquire_any()
    assert a is not None and b is not None
    assert pool.acquire_any(timeout=0.1) is None  # capacity exhausted (2/2 active)

    pool.release(a)
    c = pool.acquire_any(timeout=0.5)
    assert c is not None
