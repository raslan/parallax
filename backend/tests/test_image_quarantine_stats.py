import pytest
from sqlalchemy.orm import sessionmaker

from app.api import images as images_api
from app.models.image import ImageFile
from app.models.image_library import ImageLibrary


@pytest.fixture
def calls(monkeypatch):
    log: list[tuple] = []
    monkeypatch.setattr(images_api.stats, "record_removal", lambda *a: log.append(("removal", *a)))
    monkeypatch.setattr(images_api.stats, "record_restore", lambda *a: log.append(("restore", *a)))
    return log


@pytest.fixture
def image_ids(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = ImageLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()
    ids = []
    for name in ("a.jpg", "b.jpg"):
        p = tmp_path / name
        p.write_bytes(b"x" * 10)
        row = ImageFile(library_id=lib.id, path=str(p), filename=name, extension=".jpg", size=10)
        db.add(row)
        db.commit()
        ids.append(row.id)
    db.close()
    return ids


def test_quarantine_credits_and_restore_refunds(client, image_ids, calls):
    a, b = image_ids
    assert client.post(f"/api/images/{a}/quarantine").status_code == 200
    assert client.post("/api/images/quarantine-bulk", json={"ids": [b]}).status_code == 200
    assert calls == [("removal", "image", 1, 10), ("removal", "image", 1, 10)]

    calls.clear()
    assert client.post(f"/api/images/{a}/restore").status_code == 200
    assert client.post("/api/images/restore-bulk", json={"ids": [b]}).status_code == 200
    assert calls == [("restore", "image", 10, None), ("restore", "image", 10, None)]


def test_deleting_a_quarantined_image_does_not_credit_twice(client, image_ids, calls):
    a, b = image_ids
    client.post("/api/images/quarantine-bulk", json={"ids": [a, b]})
    calls.clear()
    assert client.delete(f"/api/images/{a}").status_code == 204
    client.post("/api/images/delete-bulk", json={"ids": [b]})
    assert [c for c in calls if c[0] == "removal" and c[2] > 0] == []
