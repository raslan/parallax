import json

from app.schemas import GalleryOptions


def test_gallery_options_defaults():
    o = GalleryOptions()
    assert o.baseDir == ""
    assert o.maxParallel == 2
    assert o.retries == 3
    assert o.httpTimeout == 30
    assert o.typeVideo is True
    assert o.typeAudio is False
    assert o.typeAny is False
    assert o.maxSizeValue is None
    assert o.maxSizeUnit == "M"
    assert o.useArchive is True
    assert o.inputMode == "paste"


def test_gallery_options_parses_partial_blob():
    o = GalleryOptions.model_validate({"baseDir": "/media/g", "retries": 5, "typeImage": True})
    assert o.baseDir == "/media/g"
    assert o.retries == 5
    assert o.typeImage is True
    assert o.typeVideo is True  # untouched default
    assert json.loads(o.model_dump_json())["maxParallel"] == 2
