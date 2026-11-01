import shutil

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.settings import Setting


@pytest.fixture(autouse=True)
def _clean_prune_root(engine):
    with Session(engine) as s:
        s.query(Setting).filter(Setting.key == "prune_root").delete()
        s.commit()
    yield


def test_get_root_empty(client):
    r = client.get("/api/prune/root")
    assert r.status_code == 200
    assert r.json() == {"root": None}


def test_put_then_get_root(client, tmp_path):
    r = client.put("/api/prune/root", json={"path": str(tmp_path)})
    assert r.status_code == 200
    assert r.json() == {"root": str(tmp_path.resolve())}
    assert client.get("/api/prune/root").json() == {"root": str(tmp_path.resolve())}


def test_put_rejects_missing_dir(client, tmp_path):
    r = client.put("/api/prune/root", json={"path": str(tmp_path / "nope")})
    assert r.status_code == 400


def test_put_rejects_slash(client):
    r = client.put("/api/prune/root", json={"path": "/"})
    assert r.status_code == 400


def test_put_rejects_nul_byte(client, tmp_path):
    r = client.put("/api/prune/root", json={"path": str(tmp_path) + "\x00x"})
    assert r.status_code == 400


def test_get_root_after_dir_deleted_returns_409_on_use(client, db, tmp_path):
    from app.api.prune import get_root

    d = tmp_path / "gone"
    d.mkdir()
    assert client.put("/api/prune/root", json={"path": str(d)}).status_code == 200
    shutil.rmtree(d)
    with pytest.raises(HTTPException) as e:
        get_root(db)
    assert e.value.status_code == 409
    assert e.value.detail == "Folder is no longer available"


def test_get_root_unset_returns_409(db):
    from app.api.prune import get_root

    with pytest.raises(HTTPException) as e:
        get_root(db)
    assert e.value.status_code == 409
    assert e.value.detail == "No folder selected"


def test_sandboxed_maps_errors(tmp_path):
    from app.api.prune import _sandboxed

    root = str(tmp_path)
    (tmp_path / "a.txt").write_text("x")
    assert _sandboxed(root, str(tmp_path / "a.txt")) == str((tmp_path / "a.txt").resolve())
    cases = [(str(tmp_path.parent), 403), (str(tmp_path / "missing"), 404), ("\x00", 400)]
    for path, status in cases:
        with pytest.raises(HTTPException) as e:
            _sandboxed(root, path)
        assert e.value.status_code == status
