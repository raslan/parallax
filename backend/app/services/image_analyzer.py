"""
Proxy layer for GPU inference. All ONNX/NudeNet calls run in an isolated worker
subprocess so the CUDA/ROCm context is fully destroyed on idle, freeing VRAM.

Non-GPU helpers (metadata, phash, cosine_similarity) run in-process.
"""

import json
import os
import struct

import imagehash
import numpy as np
from PIL import ExifTags, Image

from app.services.worker_common import WorkerPool

_pool = WorkerPool(idle_timeout=120)  # seconds


def release_sessions() -> None:
    """Terminate the inference worker process, fully freeing GPU memory."""
    _pool.release()


def _submit(fn, *args):
    """Submit fn(*args) to the worker, recreating it if it crashed."""
    return _pool.submit(fn, *args)


# ---------------------------------------------------------------------------
# GPU inference — routed to worker subprocess
# ---------------------------------------------------------------------------


def run_nudenet(path: str, model_id: str = "320n") -> list[dict]:
    from app.services._image_analyzer_impl import run_nudenet as _fn

    return _submit(_fn, path, model_id)


def run_nudenet_batch(paths: list[str], model_id: str = "320n") -> list[list[dict]]:
    from app.services._image_analyzer_impl import run_nudenet_batch as _fn

    return _submit(_fn, paths, model_id)


def run_nudenet_batch_arrays(arrays: list, model_id: str = "320n") -> list[list[dict]]:
    from app.services._image_analyzer_impl import run_nudenet_batch_arrays as _fn

    return _submit(_fn, arrays, model_id)


# ---------------------------------------------------------------------------
# Non-GPU helpers — run in main process
# ---------------------------------------------------------------------------


def get_image_metadata(path: str) -> dict:
    img = Image.open(path)
    if hasattr(img, "n_frames"):
        img.seek(0)
    width, height = img.size
    size = os.path.getsize(path)
    exif_date = None
    exif_gps = None
    exif_camera = None
    try:
        raw = img._getexif()
        if raw:
            tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
            dt_str = tags.get("DateTimeOriginal") or tags.get("DateTime")
            if dt_str:
                from datetime import datetime

                dt = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
                exif_date = dt.timestamp()
            make = tags.get("Make", "")
            model_name = tags.get("Model", "")
            if make or model_name:
                exif_camera = f"{make} {model_name}".strip()
            gps = tags.get("GPSInfo")
            if gps:
                exif_gps = json.dumps({"raw": str(gps)})
    except (AttributeError, ValueError, KeyError, TypeError, struct.error):
        pass
    return {
        "width": width,
        "height": height,
        "size": size,
        "exif_date": exif_date,
        "exif_gps": exif_gps,
        "exif_camera": exif_camera,
    }


def compute_phash(path: str) -> int:
    img = Image.open(path)
    if hasattr(img, "n_frames"):
        img.seek(0)
    val = int(str(imagehash.phash(img)), 16)
    return val - 2**64 if val >= 2**63 else val


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    return float(np.dot(va, vb))
