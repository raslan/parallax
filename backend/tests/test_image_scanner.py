import pytest
from app.models.image_library import ImageLibrary
from app.models.image import ImageFile, ImageDetection, ImageStatus


def test_image_library_model(db):
    lib = ImageLibrary(name="My Photos", path="/media/photos")
    db.add(lib)
    db.commit()
    db.refresh(lib)
    assert lib.id is not None
    assert lib.name == "My Photos"
    assert lib.last_scanned_at is None


def test_image_model(db):
    lib = ImageLibrary(name="Test", path="/tmp/test-photos")
    db.add(lib)
    db.commit()

    img = ImageFile(
        library_id=lib.id,
        path="/tmp/test-photos/a.jpg",
        filename="a.jpg",
        extension="jpg",
        size=102400,
        width=1920,
        height=1080,
        status=ImageStatus.PENDING,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    assert img.id is not None
    assert img.phash is None
    assert img.clip_embedding is None


def test_image_detection_model(db):
    lib = ImageLibrary(name="Test2", path="/tmp/test-photos2")
    db.add(lib)
    db.commit()
    img = ImageFile(library_id=lib.id, path="/tmp/test-photos2/b.jpg",
                    filename="b.jpg", extension="jpg", size=0,
                    status=ImageStatus.SCANNED)
    db.add(img)
    db.commit()
    det = ImageDetection(image_id=img.id, label="FEMALE_BREAST_EXPOSED",
                         confidence=0.91, bbox_json="[10,20,100,80]")
    db.add(det)
    db.commit()
    db.refresh(det)
    assert det.id is not None
    assert det.confidence == 0.91


from app.schemas import ImageLibraryRead, ImageRead, ImageScanRequest

def test_image_schemas():
    req = ImageScanRequest(run_phash=True, run_nudenet=False, run_clip=True)
    assert req.run_nudenet is False
    assert req.run_phash is True


import os
import tempfile
from PIL import Image
from unittest.mock import patch, MagicMock

def _make_library_with_images(db):
    from app.models.image_library import ImageLibrary
    tmpdir = tempfile.mkdtemp()
    for name in ["a.jpg", "b.png"]:
        img = Image.new("RGB", (10, 10), color=(100, 100, 100))
        img.save(os.path.join(tmpdir, name))
    os.makedirs(os.path.join(tmpdir, "_quarantine"))
    img2 = Image.new("RGB", (10, 10))
    img2.save(os.path.join(tmpdir, "_quarantine", "hidden.jpg"))

    lib = ImageLibrary(name="Scan Test", path=tmpdir)
    db.add(lib)
    db.commit()
    db.refresh(lib)
    return lib, tmpdir


def test_collect_image_paths_excludes_underscore(db):
    from app.services.image_scanner import collect_image_paths
    lib, tmpdir = _make_library_with_images(db)
    paths = collect_image_paths(tmpdir)
    assert all("_quarantine" not in p for p in paths)
    assert len(paths) == 2


def test_generate_thumbnail(db):
    from app.services.image_scanner import generate_thumbnail
    tmpdir = tempfile.mkdtemp()
    img = Image.new("RGB", (800, 600), color=(50, 100, 200))
    src = os.path.join(tmpdir, "test.jpg")
    img.save(src)
    thumb_dir = tempfile.mkdtemp()
    out = os.path.join(thumb_dir, "1.jpg")
    generate_thumbnail(src, out)
    assert os.path.exists(out)
    thumb = Image.open(out)
    assert thumb.width <= 400
