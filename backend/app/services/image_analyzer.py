import os
import json
import struct
import threading
import numpy as np
import onnxruntime as _ort
from PIL import Image, ExifTags
import imagehash
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


_GPU_PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]

_CLIP_DEFAULT = "clip-vit-base-patch32"
_NUDENET_DEFAULT = "320n"

# CLIP ViT normalization constants (same for all CLIP variants)
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

_IDLE_TIMEOUT = 120  # seconds
_idle_timer: threading.Timer | None = None
_idle_timer_lock = threading.Lock()


def _reset_idle_timer() -> None:
    global _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
        _idle_timer = threading.Timer(_IDLE_TIMEOUT, release_sessions)
        _idle_timer.daemon = True
        _idle_timer.start()


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
    img = Image.open(path).convert("RGB")
    if hasattr(img, "n_frames"):  # GIF — use frame 0
        img.seek(0)
    img = img.resize((image_size, image_size), Image.BICUBIC)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - _CLIP_MEAN) / _CLIP_STD
    arr = arr.transpose(2, 0, 1)  # HWC → CHW
    return arr[np.newaxis]


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
    return {"width": width, "height": height, "size": size,
            "exif_date": exif_date, "exif_gps": exif_gps, "exif_camera": exif_camera}


def compute_phash(path: str) -> int:
    img = Image.open(path)
    if hasattr(img, "n_frames"):
        img.seek(0)
    val = int(str(imagehash.phash(img)), 16)
    return val - 2**64 if val >= 2**63 else val


def release_sessions() -> None:
    import gc
    global _idle_timer
    with _idle_timer_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None
    with _vision_lock, _text_lock, _nudenet_lock:
        _vision_sessions.clear()
        _text_sessions.clear()
        _nudenet_detectors.clear()
    gc.collect()


def run_nudenet(path: str, model_id: str = _NUDENET_DEFAULT) -> list[dict]:
    _reset_idle_timer()
    detector = _get_nudenet_detector(model_id)
    results = detector.detect(path)
    return [{"label": r["class"], "confidence": r["score"],
             "bbox_json": json.dumps(r["box"])} for r in results]


def run_nudenet_batch(paths: list[str], model_id: str = _NUDENET_DEFAULT) -> list[list[dict]]:
    if not paths:
        return []
    _reset_idle_timer()
    detector = _get_nudenet_detector(model_id)
    batch_results = detector.detect_batch(paths, batch_size=len(paths))
    return [
        [{"label": r["class"], "confidence": r["score"], "bbox_json": json.dumps(r["box"])}
         for r in detections]
        for detections in batch_results
    ]


def encode_image_clip(path: str, model_id: str = _CLIP_DEFAULT) -> list[float]:
    _reset_idle_timer()
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
    _reset_idle_timer()
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
    _reset_idle_timer()
    session = _get_text_session(model_id)
    input_ids = _tokenize(text)
    output = session.run(["text_embeds"], {"input_ids": input_ids})[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    return float(np.dot(va, vb))
