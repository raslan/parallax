"""ncnn inference code that runs INSIDE the upscale worker process (see upscale_runtime.py).

Blob names are pnnx's `in0` -> `out0`. Input/output are float32 CHW RGB in 0-1.
"""

import os

import numpy as np

from app.services.upscale_runtime import run_with_fallback

_nets: dict[tuple, object] = {}


def _load(param_path: str, bin_path: str, device: str, gpu_index: int):
    import ncnn

    key = (param_path, device, gpu_index if device == "gpu" else 0)
    net = _nets.get(key)
    if net is not None:
        return net
    net = ncnn.Net()
    if device == "gpu":
        net.opt.use_vulkan_compute = True
        net.set_vulkan_device(gpu_index)
        net.opt.use_fp16_packed = net.opt.use_fp16_storage = net.opt.use_fp16_arithmetic = True
    else:
        net.opt.use_vulkan_compute = False
        net.opt.num_threads = os.cpu_count() or 1
    if net.load_param(param_path) or net.load_model(bin_path):
        raise RuntimeError(f"ncnn failed to load {os.path.basename(param_path)}")
    _nets[key] = net
    return net


def _infer(net, tile: np.ndarray) -> np.ndarray:
    import ncnn

    # ncnn.Mat borrows the array's memory: keep a reference until the clone has copied it.
    data = np.ascontiguousarray(tile, dtype=np.float32)
    with net.create_extractor() as ex:
        ex.input("in0", ncnn.Mat(data).clone())
        _, out = ex.extract("out0")
        return np.array(out)


def run_tile(
    param_path: str, bin_path: str, device: str, tile: np.ndarray, gpu_index: int = 0
) -> np.ndarray:
    primary = _load(param_path, bin_path, device, gpu_index)
    if device != "gpu":
        out = _infer(primary, tile)
        if np.isnan(out).any():
            raise RuntimeError("model produced NaN")
        return out
    # GPU fp16 can overflow to NaN: redo that tile on a lazily-loaded CPU fp32 net kept for the job.
    return run_with_fallback(
        lambda t: _infer(primary, t),
        lambda t: _infer(_load(param_path, bin_path, "cpu", 0), t),
        tile,
    )
