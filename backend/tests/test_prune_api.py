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


def _scan_via_api(client):
    import time

    assert client.post("/api/prune/scan").status_code == 200
    for _ in range(200):
        s = client.get("/api/prune/scan").json()
        if s["status"] != "running":
            return s
        time.sleep(0.05)
    raise AssertionError("scan did not finish")


@pytest.fixture
def _scan_reset():
    from app.services import prune_scan

    prune_scan.invalidate()
    yield
    prune_scan.invalidate()


def test_put_root_clears_scan_cache(client, tmp_path, _scan_reset):
    from app.services import prune_scan

    (tmp_path / "a.jpg").write_bytes(b"x")
    client.put("/api/prune/root", json={"path": str(tmp_path)})
    assert _scan_via_api(client)["status"] == "done"
    assert prune_scan.get_node(str(tmp_path.resolve())) is not None
    client.put("/api/prune/root", json={"path": str(tmp_path)})
    assert prune_scan.get_node(str(tmp_path.resolve())) is None
    assert client.get("/api/prune/scan").json()["status"] == "idle"


def test_scan_requires_root(client, _scan_reset):
    assert client.post("/api/prune/scan").status_code == 409
    assert client.get("/api/prune/scan").status_code == 409


def test_folder_endpoint_breadcrumbs_and_subfolders(client, tmp_path, _scan_reset):
    (tmp_path / "b").mkdir()
    (tmp_path / "a" / "x").mkdir(parents=True)
    (tmp_path / "a" / "x" / "p.jpg").write_bytes(b"xyz")
    (tmp_path / "한글").mkdir()
    client.put("/api/prune/root", json={"path": str(tmp_path)})
    _scan_via_api(client)
    root = str(tmp_path.resolve())

    top = client.get("/api/prune/folder", params={"path": root}).json()
    assert top["parent"] is None
    assert [s["name"] for s in top["subfolders"]] == ["a", "b", "한글"]
    assert top["total"]["images"] == 1 and top["total"]["bytes"] == 3
    assert top["subfolders"][0]["total"]["files"] == 1
    assert top["subfolders"][0]["direct"]["files"] == 0

    deep = client.get("/api/prune/folder", params={"path": root + "/a/x"}).json()
    assert deep["parent"] == root + "/a"
    assert [c["name"] for c in deep["breadcrumbs"]][1:] == ["a", "x"]
    assert deep["breadcrumbs"][0]["path"] == root
    assert deep["direct"]["images"] == 1
    assert deep["subfolders"] == []


def test_folder_endpoint_409_while_scanning(client, tmp_path, _scan_reset):
    from app.services import prune_scan

    client.put("/api/prune/root", json={"path": str(tmp_path)})
    prune_scan._state["status"] = "running"
    r = client.get("/api/prune/folder", params={"path": str(tmp_path)})
    assert r.status_code == 409
    assert r.json()["detail"] == "scanning"


def test_folder_not_cached_404(client, tmp_path, _scan_reset):
    client.put("/api/prune/root", json={"path": str(tmp_path)})
    r = client.get("/api/prune/folder", params={"path": str(tmp_path)})
    assert r.status_code == 404


def test_folder_outside_root_403(client, tmp_path, _scan_reset):
    root = tmp_path / "root"
    root.mkdir()
    client.put("/api/prune/root", json={"path": str(root)})
    _scan_via_api(client)
    assert client.get("/api/prune/folder", params={"path": str(tmp_path)}).status_code == 403
    assert client.get("/api/prune/folder", params={"path": str(root / "..")}).status_code == 403


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
