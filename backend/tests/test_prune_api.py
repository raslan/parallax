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


def _put_root(client, path):
    assert client.put("/api/prune/root", json={"path": str(path)}).status_code == 200


def test_files_endpoint_lists_unicode_and_other(client, tmp_path):
    (tmp_path / "한글.jpg").write_bytes(b"x")
    (tmp_path / "n.txt").write_bytes(b"x")
    (tmp_path / ".h.jpg").write_bytes(b"x")
    _put_root(client, tmp_path)
    r = client.get("/api/prune/files", params={"path": str(tmp_path)})
    assert r.status_code == 200
    got = {f["name"]: f["kind"] for f in r.json()}
    assert got == {"한글.jpg": "image", "n.txt": "other"}


def test_files_endpoint_errors(client, tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "f.txt").write_bytes(b"x")
    assert client.get("/api/prune/files", params={"path": str(root)}).status_code == 409
    _put_root(client, root)
    assert client.get("/api/prune/files", params={"path": str(tmp_path)}).status_code == 403
    assert client.get("/api/prune/files", params={"path": str(root / "f.txt")}).status_code == 400
    assert client.get("/api/prune/files", params={"path": str(root / "zz")}).status_code == 404
    assert client.get("/api/prune/files", params={"path": "\x00"}).status_code == 400


def test_delete_endpoint(client, tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"x")
    _put_root(client, tmp_path)
    r = client.post(
        "/api/prune/delete", json={"paths": [str(tmp_path / "a.jpg"), str(tmp_path / "gone.jpg")]}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] == [str(tmp_path / "a.jpg")]
    assert [f["path"] for f in body["failed"]] == [str(tmp_path / "gone.jpg")]
    assert body["empty_folders"] == []  # the root is never offered for deletion


def test_delete_endpoint_requires_root(client, tmp_path):
    assert client.post("/api/prune/delete", json={"paths": []}).status_code == 409


def test_delete_folder_requires_dir(client, tmp_path):
    (tmp_path / "f.txt").write_bytes(b"x")
    (tmp_path / "d").mkdir()
    _put_root(client, tmp_path)
    r = client.post("/api/prune/delete-folder", json={"path": str(tmp_path / "f.txt")})
    assert r.status_code == 400
    assert client.post("/api/prune/delete-folder", json={"path": str(tmp_path)}).status_code == 400
    assert client.post("/api/prune/delete-folder", json={"path": "\x00"}).status_code == 400
    assert (
        client.post("/api/prune/delete-folder", json={"path": str(tmp_path / "x")}).status_code
        == 404
    )
    assert (
        client.post("/api/prune/delete-folder", json={"path": str(tmp_path / "d")}).status_code
        == 204
    )
    assert not (tmp_path / "d").exists()


def test_folder_endpoint_survives_concurrent_remove(client, tmp_path, _scan_reset):
    import threading

    from app.services import prune_scan

    for i in range(300):
        (tmp_path / f"d{i}").mkdir()
    _put_root(client, tmp_path)
    _scan_via_api(client)
    root = str(tmp_path.resolve())
    stop = threading.Event()

    def churn():
        for i in range(300):
            if stop.is_set():
                break
            prune_scan.remove_folder(f"{root}/d{i}")

    t = threading.Thread(target=churn)
    t.start()
    try:
        for _ in range(20):
            assert client.get("/api/prune/folder", params={"path": root}).status_code == 200
    finally:
        stop.set()
        t.join()


def test_details_endpoint(client, tmp_path, monkeypatch):
    from app.services import prune_files

    monkeypatch.setattr(
        prune_files,
        "probe_file",
        lambda p: {"streams": [{"codec_name": "hevc", "width": 4, "height": 2}], "format": {}},
    )
    prune_files.clear_details_cache()
    (tmp_path / "v.mp4").write_bytes(b"x")
    (tmp_path / "a.jpg").write_bytes(b"x")
    _put_root(client, tmp_path)
    v, a = str(tmp_path / "v.mp4"), str(tmp_path / "a.jpg")
    r = client.post("/api/prune/details", json={"paths": [v, a]})
    assert r.status_code == 200
    d = r.json()["details"]
    assert d[a] is None and d[v]["codec"] == "hevc" and d[v]["width"] == 4


def test_details_rejects_outside_root(client, tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "o.mp4").write_bytes(b"x")
    _put_root(client, root)
    r = client.post("/api/prune/details", json={"paths": [str(tmp_path / "o.mp4")]})
    assert r.status_code == 403
    assert client.post("/api/prune/details", json={"paths": ["\x00"]}).status_code == 400


def test_details_over_50_paths_400(client, tmp_path):
    _put_root(client, tmp_path)
    paths = [str(tmp_path / f"{i}.mp4") for i in range(51)]
    assert client.post("/api/prune/details", json={"paths": paths}).status_code == 400
    assert client.post("/api/prune/details", json={"paths": []}).status_code == 200


def test_file_endpoint_outside_root_403(client, tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "o.jpg").write_bytes(b"x")
    _put_root(client, root)
    assert (
        client.get("/api/prune/file", params={"path": str(tmp_path / "o.jpg")}).status_code == 403
    )
    assert (
        client.get("/api/prune/thumbnail", params={"path": str(tmp_path / "o.jpg")}).status_code
        == 403
    )


def test_file_endpoint_supports_range(client, tmp_path):
    (tmp_path / "v.mp4").write_bytes(bytes(range(100)))
    _put_root(client, tmp_path)
    r = client.get(
        "/api/prune/file", params={"path": str(tmp_path / "v.mp4")}, headers={"Range": "bytes=0-9"}
    )
    assert r.status_code == 206
    assert r.content == bytes(range(10))


def test_audio_endpoint_only_for_non_native_extension(client, tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"x")
    (tmp_path / "a.wma").write_bytes(b"x")
    _put_root(client, tmp_path)
    assert (
        client.get("/api/prune/audio", params={"path": str(tmp_path / "a.mp3")}).status_code == 400
    )
    assert (
        client.get("/api/prune/audio", params={"path": str(tmp_path / "b.wma")}).status_code == 404
    )


def test_thumbnail_endpoint_404_for_audio(client, tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"x")
    _put_root(client, tmp_path)
    assert (
        client.get("/api/prune/thumbnail", params={"path": str(tmp_path / "a.mp3")}).status_code
        == 404
    )
