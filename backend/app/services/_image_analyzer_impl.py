import os
import json
import threading
import numpy as np
import onnxruntime as _ort
from nudenet import NudeDetector

from app.services.model_manager import (
    CLIP_MODELS,
    NUDENET_MODELS,
    clip_vision_path,
    clip_text_path,
    nudenet_path,
)


def _make_session_options() -> _ort.SessionOptions:
    opts = _ort.SessionOptions()
    opts.enable_mem_pattern = False
    return opts


_GPU_PROVIDERS = ["CUDAExecutionProvider", "ROCMExecutionProvider", "CPUExecutionProvider"]

_CLIP_DEFAULT = "clip-vit-base-patch32"
_NUDENET_DEFAULT = "320n"

_CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

_vision_sessions: dict[str, _ort.InferenceSession] = {}
_text_sessions: dict[str, _ort.InferenceSession] = {}
_nudenet_detectors: dict[str, NudeDetector] = {}
_tokenizer = None

_vision_lock = threading.Lock()
_text_lock = threading.Lock()
_nudenet_lock = threading.Lock()
_tokenizer_lock = threading.Lock()


def _get_vision_session(model_id: str = _CLIP_DEFAULT) -> _ort.InferenceSession:
    with _vision_lock:
        if model_id not in _vision_sessions:
            _vision_sessions[model_id] = _ort.InferenceSession(
                clip_vision_path(model_id), providers=_GPU_PROVIDERS, sess_options=_make_session_options()
            )
        return _vision_sessions[model_id]


def _get_text_session(model_id: str = _CLIP_DEFAULT) -> _ort.InferenceSession:
    with _text_lock:
        if model_id not in _text_sessions:
            _text_sessions[model_id] = _ort.InferenceSession(
                clip_text_path(model_id), providers=_GPU_PROVIDERS, sess_options=_make_session_options()
            )
        return _text_sessions[model_id]


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


def _get_tokenizer():
    global _tokenizer
    with _tokenizer_lock:
        if _tokenizer is None:
            from transformers import CLIPTokenizer
            _tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
    return _tokenizer


def _tokenize(text: str) -> np.ndarray:
    tok = _get_tokenizer()
    enc = tok(text, return_tensors="np", padding="max_length",
               max_length=77, truncation=True)
    return enc["input_ids"].astype(np.int64)


def _preprocess_image(path: str, image_size: int = 224) -> np.ndarray:
    from PIL import Image
    img = Image.open(path).convert("RGB")
    if hasattr(img, "n_frames"):
        img.seek(0)
    img = img.resize((image_size, image_size), Image.BICUBIC)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - _CLIP_MEAN) / _CLIP_STD
    arr = arr.transpose(2, 0, 1)
    return arr[np.newaxis]


def run_nudenet(path: str, model_id: str = _NUDENET_DEFAULT) -> list[dict]:
    detector = _get_nudenet_detector(model_id)
    results = detector.detect(path)
    return [{"label": r["class"], "confidence": r["score"],
             "bbox_json": json.dumps(r["box"])} for r in results]


def run_nudenet_batch(paths: list[str], model_id: str = _NUDENET_DEFAULT) -> list[list[dict]]:
    if not paths:
        return []
    detector = _get_nudenet_detector(model_id)
    batch_results = detector.detect_batch(paths, batch_size=len(paths))
    return [
        [{"label": r["class"], "confidence": r["score"], "bbox_json": json.dumps(r["box"])}
         for r in detections]
        for detections in batch_results
    ]


def encode_image_clip(path: str, model_id: str = _CLIP_DEFAULT) -> list[float]:
    session = _get_vision_session(model_id)
    image_size = CLIP_MODELS.get(model_id, {}).get("image_size", 224)
    pixel_values = _preprocess_image(path, image_size)
    output = session.run(["image_embeds"], {"pixel_values": pixel_values})[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def encode_image_clip_batch(paths: list[str], model_id: str = _CLIP_DEFAULT) -> list[list[float]]:
    if not paths:
        return []
    session = _get_vision_session(model_id)
    image_size = CLIP_MODELS.get(model_id, {}).get("image_size", 224)
    batch = np.concatenate([_preprocess_image(p, image_size) for p in paths], axis=0)
    output = session.run(["image_embeds"], {"pixel_values": batch})[0]
    results = []
    for vec in output:
        v = vec.astype(np.float64)
        norm = np.linalg.norm(v)
        if norm > 0:
            v = v / norm
        results.append(v.tolist())
    return results


def encode_text_clip(text: str, model_id: str = _CLIP_DEFAULT) -> list[float]:
    session = _get_text_session(model_id)
    input_ids = _tokenize(text)
    output = session.run(["text_embeds"], {"input_ids": input_ids})[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()
