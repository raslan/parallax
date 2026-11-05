import os

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.image import ImageDetection, ImageFile, ImageStatus
from app.models.image_library import ImageLibrary
from app.services import image_quarantine as iq
from app.services import image_scanner


@pytest.fixture
def db(engine):
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


@pytest.fixture
def row(db, tmp_path):
    lib = ImageLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    p = tmp_path / "a.jpg"
    p.write_bytes(b"orig")
    r = ImageFile(library_id=lib.id, path=str(p), filename="a.jpg", extension=".jpg", size=4)
    db.add(r)
    db.commit()
    return r


def test_move_to_quarantine_moves_file_and_marks_row(db, row, tmp_path):
    dest = iq.move_to_quarantine(row)
    db.commit()
    assert dest == str(tmp_path / "_quarantine" / "a.jpg")
    assert not (tmp_path / "a.jpg").exists()
    assert (tmp_path / "_quarantine" / "a.jpg").read_bytes() == b"orig"
    assert row.path == dest and row.status == ImageStatus.QUARANTINED
    assert row.filename == "a.jpg"  # restore puts it back under the original name


def test_move_to_quarantine_never_overwrites_an_earlier_quarantined_file(db, row, tmp_path):
    (tmp_path / "_quarantine").mkdir()
    (tmp_path / "_quarantine" / "a.jpg").write_bytes(b"older")
    dest = iq.move_to_quarantine(row)
    assert (tmp_path / "_quarantine" / "a.jpg").read_bytes() == b"older"
    assert dest != str(tmp_path / "_quarantine" / "a.jpg")
    assert open(dest, "rb").read() == b"orig"
    assert row.filename == "a.jpg"


def test_forget_image_row_removes_row_detections_and_thumbnail(db, row, tmp_path, monkeypatch):
    monkeypatch.setattr(image_scanner, "THUMBNAIL_DIR", str(tmp_path / "thumbs"))
    os.makedirs(tmp_path / "thumbs")
    (tmp_path / "thumbs" / f"{row.id}.jpg").write_bytes(b"t")
    db.add(ImageDetection(image_id=row.id, label="x", confidence=0.5))
    db.commit()
    rid = row.id

    iq.forget_image_row(db, row)
    db.commit()

    assert db.get(ImageFile, rid) is None
    assert db.query(ImageDetection).filter_by(image_id=rid).count() == 0
    assert not (tmp_path / "thumbs" / f"{rid}.jpg").exists()
    assert (tmp_path / "a.jpg").exists()  # the file itself is the caller's business
