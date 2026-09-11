import glob
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass

from app.services.encoder import _CONCURRENT_HINT

_HWACCEL_FAILURE_RE = re.compile(
    r"error initializ\w+ (?:a )?cuda"
    r"|cannot load \w*cuda\w*"
    r"|failed to set value .* for option ['\"]?hwaccel"
    r"|vainitialize failed"
    r"|failed to initiali[sz]e vaapi"
    r"|no vaapi support",
    re.IGNORECASE,
)


def is_hwaccel_failure(stderr_text: str) -> bool:
    """True if ffmpeg's stderr names a hwaccel/device-init failure specifically,
    as opposed to any other encode error (bad args, unsupported input, etc)."""
    return bool(stderr_text) and bool(_HWACCEL_FAILURE_RE.search(stderr_text))


@dataclass(frozen=True)
class GPUDevice:
    vendor: str  # "nvidia" | "amd" | "intel" | "unknown"
    index: str  # nvidia: "0", "1", ...; vaapi: "/dev/dri/renderD128" etc.
    label: str  # GPU model name, or the bare node name if unknown
    family: str  # "nvenc" | "vaapi" — matches encoder.py's family strings


def _detect_nvidia() -> list[GPUDevice]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []
    devices = []
    for line in result.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",", 1)]
        if len(parts) != 2:
            continue
        index, name = parts
        devices.append(GPUDevice(vendor="nvidia", index=index, label=name, family="nvenc"))
    return devices


def _read_pci_vendor(render_path: str) -> str | None:
    node = os.path.basename(render_path)
    try:
        with open(f"/sys/class/drm/{node}/device/vendor") as f:
            return f.read().strip().lower()
    except OSError:
        return None


_PCI_VENDOR_MAP = {"0x1002": "amd", "0x8086": "intel"}

# nvidia-container-toolkit's "video" capability exposes an NVIDIA card's own
# VA-API render node for NVENC/NVDEC interop — without this, that same
# physical card would be double-counted here (as an "unknown"-vendor vaapi
# device) on top of _detect_nvidia()'s nvenc entry for it.
_NVIDIA_PCI_VENDOR = "0x10de"


def _detect_vaapi() -> list[GPUDevice]:
    devices = []
    for path in sorted(glob.glob("/dev/dri/renderD*")):
        if not os.access(path, os.R_OK | os.W_OK):
            continue
        vendor_id = _read_pci_vendor(path)
        if vendor_id == _NVIDIA_PCI_VENDOR:
            continue
        vendor = _PCI_VENDOR_MAP.get(vendor_id or "", "unknown")
        devices.append(
            GPUDevice(vendor=vendor, index=path, label=os.path.basename(path), family="vaapi")
        )
    return devices


_gpus: list[GPUDevice] | None = None


def detect_gpus() -> list[GPUDevice]:
    """All usable GPU devices, NVIDIA + AMD/Intel combined. Cached at module
    scope — device topology doesn't change at runtime."""
    global _gpus
    if _gpus is None:
        _gpus = _detect_nvidia() + _detect_vaapi()
    return _gpus


_UNCAPPED_CAPACITY = 32  # stand-in "no known session cap" for vaapi/qsv/amf —
# generous enough to never itself become the bottleneck below the
# max_concurrent_transcodes ceiling; only nvenc enforces a real per-card cap.

_POLL_INTERVAL_SECONDS = 0.2


class GpuPool:
    """Work-stealing scheduler over a family's detected GPU devices — one
    semaphore per device, `acquire_any` hands out whichever device has a free
    slot next rather than pinning files to devices up front, so an idle card
    keeps pulling work instead of waiting its turn."""

    def __init__(self, devices: list[GPUDevice], capacity: int):
        self._devices = devices
        self._capacity = capacity
        self._sems = {d.index: threading.Semaphore(capacity) for d in devices}
        self._degraded: set[str] = set()
        self._lock = threading.Lock()

    @classmethod
    def build(cls, family: str) -> "GpuPool":
        devices = [d for d in detect_gpus() if d.family == family]
        capacity = _CONCURRENT_HINT.get(family) or _UNCAPPED_CAPACITY
        return cls(devices, capacity)

    def acquire_any(
        self, exclude: frozenset[str] = frozenset(), timeout: float | None = None
    ) -> GPUDevice | None:
        """Block until some non-excluded, non-degraded device has a free
        slot. Returns None if the pool has no eligible device at all, or (when
        `timeout` is given) none became free in time. Production callers omit
        `timeout` and wait as long as it takes — tests pass a short one."""
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                live = [
                    d
                    for d in self._devices
                    if d.index not in exclude and d.index not in self._degraded
                ]
            if not live:
                return None
            for d in live:
                if self._sems[d.index].acquire(blocking=False):
                    return d
            if deadline is not None and time.monotonic() >= deadline:
                return None
            time.sleep(_POLL_INTERVAL_SECONDS)

    def release(self, device: GPUDevice) -> None:
        self._sems[device.index].release()

    def mark_degraded(self, device: GPUDevice) -> None:
        with self._lock:
            self._degraded.add(device.index)
