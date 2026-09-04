from unittest.mock import patch

from PIL import Image


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
    import sys
    from unittest.mock import MagicMock

    from app.services import image_analyzer

    path = _make_test_image()
    mock_result = [{"label": "FEMALE_BREAST_EXPOSED", "score": 0.91, "box": [10, 20, 100, 80]}]
    # run_nudenet lazily imports app.services._image_analyzer_impl, which in
    # turn imports the real `nudenet` package — not installed outside the
    # Docker image. Stub the impl module in sys.modules so the proxy's
    # delegation logic can be tested without that dependency.
    fake_impl = MagicMock()
    with patch.dict(sys.modules, {"app.services._image_analyzer_impl": fake_impl}):
        with patch.object(image_analyzer, "_submit", return_value=mock_result) as mock_submit:
            detections = image_analyzer.run_nudenet(path)
    mock_submit.assert_called_once_with(fake_impl.run_nudenet, path, "320n")
    assert detections == mock_result
