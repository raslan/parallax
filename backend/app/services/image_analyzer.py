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
SIGLIP_DIR = os.path.join(MODELS_DIR, "siglip")
SIGLIP_VISION_PATH = os.path.join(SIGLIP_DIR, "vision.onnx")
SIGLIP_TEXT_PATH = os.path.join(SIGLIP_DIR, "text.onnx")
SIGLIP_REPO = "Xenova/siglip-base-patch16-224"

_vision_session = None
_text_session = None
_tokenizer = None
_vision_lock = threading.Lock()
_text_lock = threading.Lock()
_tokenizer_lock = threading.Lock()


def _download_siglip_if_needed() -> None:
    os.makedirs(SIGLIP_DIR, exist_ok=True)
    if not os.path.exists(SIGLIP_VISION_PATH):
        from huggingface_hub import hf_hub_download
        src = hf_hub_download(repo_id=SIGLIP_REPO, filename="onnx/model.onnx",
                              local_dir=SIGLIP_DIR)
        shutil.move(src, SIGLIP_VISION_PATH)
    if not os.path.exists(SIGLIP_TEXT_PATH):
        from huggingface_hub import hf_hub_download
        src = hf_hub_download(repo_id=SIGLIP_REPO, filename="onnx/text_model.onnx",
                              local_dir=SIGLIP_DIR)
        shutil.move(src, SIGLIP_TEXT_PATH)


def _get_vision_session():
    global _vision_session
    with _vision_lock:
        if _vision_session is None:
            _download_siglip_if_needed()
            _vision_session = _ort.InferenceSession(SIGLIP_VISION_PATH, providers=_GPU_PROVIDERS)
    return _vision_session


def _get_text_session():
    global _text_session
    with _text_lock:
        if _text_session is None:
            _download_siglip_if_needed()
            _text_session = _ort.InferenceSession(SIGLIP_TEXT_PATH, providers=_GPU_PROVIDERS)
    return _text_session


def _get_tokenizer():
    global _tokenizer
    with _tokenizer_lock:
        if _tokenizer is None:
            from transformers import AutoTokenizer
            _tokenizer = AutoTokenizer.from_pretrained("google/siglip-base-patch16-224")
    return _tokenizer


def _tokenize(text: str) -> dict:
    tok = _get_tokenizer()
    enc = tok(text, return_tensors="np", padding="max_length",
               max_length=64, truncation=True)
    return {"input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64)}


def _preprocess_image(path: str) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if hasattr(img, "n_frames"):  # GIF — use frame 0
        img.seek(0)
    img = img.resize((224, 224), Image.BICUBIC)
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = (arr - 0.5) / 0.5
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
    return int(str(imagehash.phash(img)), 16)


def run_nudenet(path: str) -> list[dict]:
    detector = NudeDetector()
    detector.onnx_session = _ort.InferenceSession(_NUDENET_MODEL, providers=_GPU_PROVIDERS)
    results = detector.detect(path)
    return [{"label": r["label"], "confidence": r["score"],
             "bbox_json": json.dumps(r["box"])} for r in results]


def encode_image_siglip(path: str) -> list[float]:
    session = _get_vision_session()
    pixel_values = _preprocess_image(path)
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: pixel_values})[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def encode_text_siglip(text: str) -> list[float]:
    session = _get_text_session()
    tokens = _tokenize(text)
    inputs = {session.get_inputs()[0].name: tokens["input_ids"],
              session.get_inputs()[1].name: tokens["attention_mask"]}
    output = session.run(None, inputs)[0]
    vec = output[0].astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    return float(np.dot(va, vb))
