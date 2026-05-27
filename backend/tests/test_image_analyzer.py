import json
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image
import numpy as np
import io


def _make_test_image() -> str:
    """Write a 64x64 red JPEG to a temp path and return the path."""
    import tempfile
    img = Image.new("RGB", (64, 64), color=(200, 50, 50))
    f = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    img.save(f.name)
    return f.name


def test_get_image_metadata_basic():
    from app.services.image_analyzer import get_image_metadata
    path = _make_test_image()
    meta = get_image_metadata(path)
    assert meta["width"] == 64
    assert meta["height"] == 64
    assert meta["size"] > 0
    assert meta["exif_date"] is None
    assert meta["exif_camera"] is None


def test_compute_phash():
    from app.services.image_analyzer import compute_phash
    path = _make_test_image()
    h = compute_phash(path)
    assert isinstance(h, int)


def test_run_nudenet_mocked():
    from app.services.image_analyzer import run_nudenet
    path = _make_test_image()
    mock_result = [{"label": "FEMALE_BREAST_EXPOSED", "score": 0.91, "box": [10, 20, 100, 80]}]
    with patch("app.services.image_analyzer.NudeDetector") as MockDetector:
        instance = MockDetector.return_value
        instance.detect.return_value = mock_result
        detections = run_nudenet(path)
    assert len(detections) == 1
    assert detections[0]["label"] == "FEMALE_BREAST_EXPOSED"
    assert detections[0]["confidence"] == 0.91


def test_run_siglip_encode_image_mocked():
    from app.services.image_analyzer import encode_image_siglip
    path = _make_test_image()
    fake_embedding = np.ones(512, dtype=np.float32)
    with patch("app.services.image_analyzer._get_vision_session") as mock_sess:
        mock_sess.return_value.run.return_value = [fake_embedding.reshape(1, 512)]
        with patch("app.services.image_analyzer._preprocess_image") as mock_pre:
            mock_pre.return_value = np.zeros((1, 3, 224, 224), dtype=np.float32)
            embedding = encode_image_siglip(path)
    assert isinstance(embedding, list)
    assert len(embedding) == 512


def test_search_siglip_mocked():
    from app.services.image_analyzer import encode_text_siglip
    fake_embedding = np.ones(512, dtype=np.float32)
    with patch("app.services.image_analyzer._get_text_session") as mock_sess:
        mock_sess.return_value.run.return_value = [fake_embedding.reshape(1, 512)]
        with patch("app.services.image_analyzer._tokenize") as mock_tok:
            mock_tok.return_value = {"input_ids": np.zeros((1, 64), dtype=np.int64),
                                     "attention_mask": np.ones((1, 64), dtype=np.int64)}
            result = encode_text_siglip("food")
    assert isinstance(result, list)
    assert len(result) == 512
