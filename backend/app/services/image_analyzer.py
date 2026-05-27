import os
import json
import shutil
import struct
import threading
import numpy as np
import onnxruntime as _ort
from PIL import Image, ExifTags
import imagehash
import nudenet as _nudenet_pkg
from nudenet import NudeDetector
from app.database import DATA_DIR

_GPU_PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
_NUDENET_MODEL = os.path.join(os.path.dirname(_nudenet_pkg.__file__), "320n.onnx")

MODELS_DIR = os.path.join(DATA_DIR, "models")
CLIP_DIR = os.path.join(MODELS_DIR, "clip")
CLIP_VISION_PATH = os.path.join(CLIP_DIR, "vision.onnx")
CLIP_TEXT_PATH = os.path.join(CLIP_DIR, "text.onnx")
CLIP_REPO = "Xenova/clip-vit-base-patch32"

# CLIP ViT-B/32 image normalization constants
_CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

_vision_session = None
_text_session = None
_nudenet_session = None
_tokenizer = None
_vision_lock = threading.Lock()
_text_lock = threading.Lock()
_nudenet_lock = threading.Lock()
_tokenizer_lock = threading.Lock()


def _download_clip_if_needed() -> None:
    os.makedirs(CLIP_DIR, exist_ok=True)
    if not os.path.exists(CLIP_VISION_PATH):
        from huggingface_hub import hf_hub_download
        src = hf_hub_download(repo_id=CLIP_REPO, filename="onnx/vision_model.onnx",
                              local_dir=CLIP_DIR)
        shutil.move(src, CLIP_VISION_PATH)
    if not os.path.exists(CLIP_TEXT_PATH):
        from huggingface_hub import hf_hub_download
        src = hf_hub_download(repo_id=CLIP_REPO, filename="onnx/text_model.onnx",
                              local_dir=CLIP_DIR)
        shutil.move(src, CLIP_TEXT_PATH)


def _get_vision_session():
    global _vision_session
    with _vision_lock:
        if _vision_session is None:
            _download_clip_if_needed()
            _vision_session = _ort.InferenceSession(CLIP_VISION_PATH, providers=_GPU_PROVIDERS)
    return _vision_session


def _get_text_session():
    global _text_session
    with _text_lock:
        if _text_session is None:
            _download_clip_if_needed()
            _text_session = _ort.InferenceSession(CLIP_TEXT_PATH, providers=_GPU_PROVIDERS)
    return _text_session


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


def _preprocess_image(path: str) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if hasattr(img, "n_frames"):  # GIF — use frame 0
        img.seek(0)
    img = img.resize((224, 224), Image.BICUBIC)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - _CLIP_MEAN) / _CLIP_STD
    arr = arr.transpose(2, 0, 1)  # HWC → CHW
    return arr[np.newaxis]  # [1, 3, 224, 224]


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


def _get_nudenet_session() -> _ort.InferenceSession:
    global _nudenet_session
    with _nudenet_lock:
        if _nudenet_session is None:
            _nudenet_session = _ort.InferenceSession(_NUDENET_MODEL, providers=_GPU_PROVIDERS)
    return _nudenet_session


def release_sessions() -> None:
    global _vision_session, _text_session, _nudenet_session
    with _vision_lock:
        _vision_session = None
    with _text_lock:
        _text_session = None
    with _nudenet_lock:
        _nudenet_session = None


def run_nudenet(path: str) -> list[dict]:
    detector = NudeDetector()
    detector.onnx_session = _get_nudenet_session()
    results = detector.detect(path)
    return [{"label": r["class"], "confidence": r["score"],
             "bbox_json": json.dumps(r["box"])} for r in results]


def encode_image_clip(path: str) -> list[float]:
    session = _get_vision_session()
    pixel_values = _preprocess_image(path)
    output = session.run(["image_embeds"], {"pixel_values": pixel_values})[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def encode_text_clip(text: str) -> list[float]:
    session = _get_text_session()
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
