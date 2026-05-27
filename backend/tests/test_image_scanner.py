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
    assert img.siglip_embedding is None


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
