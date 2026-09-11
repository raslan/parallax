import glob
import os
import re
import subprocess
from dataclasses import dataclass

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


def _detect_vaapi() -> list[GPUDevice]:
    devices = []
    for path in sorted(glob.glob("/dev/dri/renderD*")):
        if not os.access(path, os.R_OK | os.W_OK):
            continue
        vendor_id = _read_pci_vendor(path)
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
