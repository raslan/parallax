import json
import os
import threading

import numpy as np
from nudenet import NudeDetector
from PIL import Image

from app.services.model_manager import NUDENET_MODELS, nudenet_path

_NUDENET_DEFAULT = "320n"

_nudenet_detectors: dict[str, NudeDetector] = {}
_nudenet_lock = threading.Lock()


def _get_nudenet_detector(model_id: str = _NUDENET_DEFAULT) -> NudeDetector:
    with _nudenet_lock:
        if model_id not in _nudenet_detectors:
            meta = NUDENET_MODELS.get(model_id)
            if meta is None:
                raise ValueError(f"Unknown NudeNet model: {model_id!r}")
            _nudenet_detectors[model_id] = NudeDetector(
                model_path=nudenet_path(model_id),
                inference_resolution=meta["inference_resolution"],
            )
        return _nudenet_detectors[model_id]


def run_nudenet(path: str, model_id: str = _NUDENET_DEFAULT) -> list[dict]:
    detector = _get_nudenet_detector(model_id)
    results = detector.detect(path)
    return [
        {"label": r["class"], "confidence": r["score"], "bbox_json": json.dumps(r["box"])}
        for r in results
    ]


def run_nudenet_batch(paths: list[str], model_id: str = _NUDENET_DEFAULT) -> list[list[dict]]:
    if not paths:
        return []
    detector = _get_nudenet_detector(model_id)
    batch_results = detector.detect_batch(paths, batch_size=len(paths))
    return [
        [
            {"label": r["class"], "confidence": r["score"], "bbox_json": json.dumps(r["box"])}
            for r in detections
        ]
        for detections in batch_results
    ]


def run_nudenet_batch_arrays(
    arrays: list[np.ndarray], model_id: str = _NUDENET_DEFAULT
) -> list[list[dict]]:
    """NudeNet detection from in-memory RGB numpy arrays. Writes to tmpfs (/tmp) transiently."""
    if not arrays:
        return []
    import tempfile

    with tempfile.TemporaryDirectory(prefix="parallax_nn_") as tmpdir:
        paths = []
        for i, arr in enumerate(arrays):
            p = os.path.join(tmpdir, f"f{i:04d}.jpg")
            Image.fromarray(arr).save(p, quality=90)
            paths.append(p)
        return run_nudenet_batch(paths, model_id)
