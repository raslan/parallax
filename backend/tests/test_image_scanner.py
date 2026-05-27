import pytest
from app.models.image_library import ImageLibrary


def test_image_library_model(db):
    lib = ImageLibrary(name="My Photos", path="/media/photos")
    db.add(lib)
    db.commit()
    db.refresh(lib)
    assert lib.id is not None
    assert lib.name == "My Photos"
    assert lib.last_scanned_at is None
