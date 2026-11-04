"""Main-process proxy for ncnn upscale inference: GPU probe, device choice, tile submission.

The main process never creates a Vulkan instance. The probe runs in a one-shot subprocess, and
inference runs in a spawned worker (`_image_upscaler_impl`) that is freed after 2 idle minutes, so
VRAM is always released.
"""

import json
import subprocess
import sys
import threading
from collections.abc import Callable

import numpy as np

from app.services.upscale_models import UpscaleTier
from app.services.worker_common import WorkerPool

PROBE_TIMEOUT = 10  # seconds

# Prints every Vulkan device ncnn can see as JSON.
# type(): 0 discrete, 1 integrated, 2 virtual, 3 cpu.
PROBE = """
import json, ncnn
out = []
for i in range(ncnn.get_gpu_count()):
    g = ncnn.get_gpu_info(i)
    out.append({"index": i, "type": int(g.type()), "name": str(g.device_name())})
print(json.dumps(out))
ncnn.destroy_gpu_instance()
"""

_pool = WorkerPool(idle_timeout=120)
_probe_lock = threading.Lock()
_probe_done = False
_probe_index: int | None = None


def pick_device_index(devices: list[dict]) -> int | None:
    """Index of the first discrete GPU (type 0), or None.

    Integrated GPUs are skipped: measured ~1.75x slower than the CPU path on an Intel UHD 630.
    Software rasterisers (llvmpipe, type 3) never count either.
    """
    for d in devices:
        if d.get("type") == 0:
            return int(d["index"])
    return None


def _probe() -> int | None:
    try:
        r = subprocess.run(
            [sys.executable, "-I", "-c", PROBE],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
        )
        if r.returncode != 0:
            return None
        return pick_device_index(json.loads(r.stdout.strip().splitlines()[-1]))
    except (subprocess.SubprocessError, OSError, ValueError, IndexError, TypeError, KeyError):
        return None


def gpu_device_index() -> int | None:
    """Index of the Vulkan device Auto mode uses, probed once per process (None = CPU only)."""
    global _probe_done, _probe_index
    with _probe_lock:
        if not _probe_done:
            _probe_index = _probe()
            _probe_done = True
        return _probe_index


def gpu_available() -> bool:
    return gpu_device_index() is not None


def choose_device(force_cpu: bool) -> str:
    """ "cpu" when forced or no usable GPU, else "gpu". Never probes when forced."""
    if force_cpu or not gpu_available():
        return "cpu"
    return "gpu"


def run_with_fallback(
    primary: Callable[[np.ndarray], np.ndarray],
    fallback: Callable[[np.ndarray], np.ndarray],
    tile: np.ndarray,
) -> np.ndarray:
    """primary(tile), re-run through fallback when it yields NaN (fp16 overflow on some GPUs)."""
    out = primary(tile)
    if not np.isnan(out).any():
        return out
    out = fallback(tile)
    if np.isnan(out).any():
        raise RuntimeError("model produced NaN")
    return out


def run_tile(tier: UpscaleTier, device: str, tile: np.ndarray) -> np.ndarray:
    """(3, 224, 224) float32 -> (3, 224*native, 224*native) float32, computed in the worker."""
    from app.services._image_upscaler_impl import run_tile as _fn

    index = (gpu_device_index() or 0) if device == "gpu" else 0
    return _pool.submit(_fn, tier.param_path, tier.bin_path, device, tile, index)


def release_sessions() -> None:
    """Terminate the upscale worker, freeing its memory and any GPU context."""
    _pool.release()
