import os
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


def test_routes_run_off_the_event_loop():
    """Every Prune route is a plain ``def`` (FastAPI runs it in the threadpool), so a
    stale mount stalling get_root / isdir / lstat can never freeze the event loop."""
    import inspect

    from app.api.prune import router

    coros = [r.path for r in router.routes if inspect.iscoroutinefunction(r.endpoint)]
    assert coros == []


def test_session_closed_before_any_filesystem_work(db, tmp_path, monkeypatch):
    """get_root reads the setting, closes the session, and only then stats the root;
    read_folder's sandbox and snapshot come after that too."""
    from types import SimpleNamespace

    from app.api import prune as api
    from app.models.settings import set_setting

    set_setting(db, "prune_root", str(tmp_path.resolve()))
    order: list[str] = []
    real_close = db.close
    monkeypatch.setattr(db, "close", lambda: order.append("close") or real_close())

    class RecordingPath:
        def __getattr__(self, name):
            fn = getattr(os.path, name)
            return lambda *a, **k: order.append(name) or fn(*a, **k)

    monkeypatch.setattr(api, "os", SimpleNamespace(path=RecordingPath(), sep=os.sep))
    real_resolve = api.resolve_inside
    monkeypatch.setattr(
        api, "resolve_inside", lambda r, p: order.append("sandbox") or real_resolve(r, p)
    )
    monkeypatch.setattr(api.prune_scan, "snapshot", lambda p: order.append("snapshot"))
    with pytest.raises(HTTPException) as e:
        api.read_folder(str(tmp_path.resolve()), db)
    assert e.value.status_code == 404  # nothing cached
    assert order[0] == "close"
    assert {"isdir", "realpath", "sandbox", "snapshot"} <= set(order)


def test_thumbnail_vanished_before_serving_is_404(db, tmp_path, monkeypatch):
    from app.api import prune as api
    from app.models.settings import set_setting
    from app.services import prune_files

    (tmp_path / "a.png").write_bytes(b"x")
    set_setting(db, "prune_root", str(tmp_path.resolve()))
    # e.g. evicted between generation and serving
    monkeypatch.setattr(prune_files, "thumbnail_for", lambda p: str(tmp_path / "gone.jpg"))
    with pytest.raises(HTTPException) as e:
        api.read_thumbnail(str(tmp_path / "a.png"), db)
    assert e.value.status_code == 404


def test_get_root_empty(client):
    r = client.get("/api/prune/root")
    assert r.status_code == 200
    assert r.json() == {"root": None}


def test_put_then_get_root(client, tmp_path):
    r = client.put("/api/prune/root", json={"path": str(tmp_path)})
    assert r.status_code == 200
    assert r.json() == {"root": str(tmp_path.resolve())}
    assert client.get("/api/prune/root").json() == {"root": str(tmp_path.resolve())}


def _scan_via_api(client, **params):
    import time

    assert client.post("/api/prune/scan", params=params).status_code == 200
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


def test_one_handler_maps_every_sandbox_error():
    """SandboxError subclasses map to status + {"detail": message} in one place."""
    import json

    from app.api.prune import sandbox_error_handler
    from app.main import app
    from app.services import prune_sandbox as sb

    assert app.exception_handlers[sb.SandboxError] is sandbox_error_handler
    cases = [
        (sb.InvalidPath("Invalid path"), 400),
        (sb.OutsideRoot("Path is outside the root folder"), 403),
        (sb.PathNotFound("Path does not exist"), 404),
        (sb.FolderNotEmpty("Folder is no longer empty"), 409),
        (sb.DeleteFailed("Could not delete folder: x"), 500),
    ]
    for exc, status in cases:
        r = sandbox_error_handler(None, exc)
        assert r.status_code == status
        assert json.loads(r.body) == {"detail": str(exc)}


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


def test_scan_reuses_cache_unless_forced_or_root_changed(client, engine, tmp_path, _scan_reset):
    from app.models.settings import set_setting

    a, b = tmp_path / "a", tmp_path / "b"
    for d in (a, b):
        d.mkdir()
        (d / "x.jpg").write_bytes(b"x")
    _put_root(client, a)
    assert _scan_via_api(client)["status"] == "done"
    (a / "y.jpg").write_bytes(b"x")

    def total(root):
        return client.get("/api/prune/folder", params={"path": str(root)}).json()["total"]

    r = client.post("/api/prune/scan")  # done + same root: no rescan
    assert r.json()["status"] == "done"
    assert total(a)["files"] == 1

    assert _scan_via_api(client, force="true")["status"] == "done"
    assert total(a)["files"] == 2

    with Session(engine) as s:  # root swapped behind the cache's back
        set_setting(s, "prune_root", str(b))
    _scan_via_api(client)
    assert client.get("/api/prune/scan").json()["root"] == str(b)
    assert total(b)["files"] == 1


def test_hidden_symlink_and_other_files_refused(client, tmp_path, monkeypatch):
    from app.services import prune_files

    monkeypatch.setattr(prune_files, "THUMB_DIR", str(tmp_path / "thumbs"))
    root = tmp_path / "root"
    (root / ".git" / "objects").mkdir(parents=True)
    (root / ".hidden").mkdir()
    for n in (".hidden/x.jpg", ".hidden/a.wma", ".hidden/v.mp4", "a.jpg", "a.wma", "n.html"):
        (root / n).write_bytes(b"<html>x</html>")
    (root / "ln.jpg").symlink_to(root / "a.jpg")
    (root / "ln.wma").symlink_to(root / "a.wma")
    _put_root(client, root)
    hidden = [
        ("post", "/api/prune/delete-folder", {"json": {"path": str(root / ".git")}}),
        ("get", "/api/prune/files", {"params": {"path": str(root / ".hidden")}}),
        ("get", "/api/prune/file", {"params": {"path": str(root / ".hidden/x.jpg")}}),
        ("get", "/api/prune/thumbnail", {"params": {"path": str(root / ".hidden/x.jpg")}}),
        ("get", "/api/prune/audio", {"params": {"path": str(root / ".hidden/a.wma")}}),
        ("post", "/api/prune/details", {"json": {"paths": [str(root / ".hidden/v.mp4")]}}),
    ]
    for method, url, kw in hidden:
        assert getattr(client, method)(url, **kw).status_code == 400, url
    assert (root / ".git" / "objects").is_dir()
    for url, name in (("/api/prune/file", "ln.jpg"), ("/api/prune/audio", "ln.wma")):
        assert client.get(url, params={"path": str(root / name)}).status_code == 404, name
    assert client.get("/api/prune/file", params={"path": str(root / "n.html")}).status_code == 415
    ok = client.get("/api/prune/file", params={"path": str(root / "a.jpg")})
    assert ok.status_code == 200 and ok.headers["x-content-type-options"] == "nosniff"


def test_root_gone_or_swapped_is_409_everywhere(client, tmp_path):
    d = tmp_path / "root"
    d.mkdir()
    _put_root(client, d)
    p = str(d / "a.jpg")
    routes = [
        ("get", "/api/prune/scan", {}),
        ("post", "/api/prune/scan", {}),
        ("get", "/api/prune/folder", {"params": {"path": str(d)}}),
        ("get", "/api/prune/files", {"params": {"path": str(d)}}),
        ("post", "/api/prune/details", {"json": {"paths": [p]}}),
        ("get", "/api/prune/thumbnail", {"params": {"path": p}}),
        ("get", "/api/prune/file", {"params": {"path": p}}),
        ("get", "/api/prune/audio", {"params": {"path": p}}),
        ("post", "/api/prune/delete", {"json": {"paths": [p]}}),
        ("post", "/api/prune/delete-folder", {"json": {"path": str(d / "x")}}),
    ]
    shutil.rmtree(d)
    for method, url, kw in routes:
        assert getattr(client, method)(url, **kw).status_code == 409, (url, "deleted")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "x").mkdir()
    d.symlink_to(elsewhere)  # saved root is now a symlink to another folder
    for method, url, kw in routes:
        assert getattr(client, method)(url, **kw).status_code == 409, (url, "swapped")
    assert (elsewhere / "x").is_dir()


def test_delete_folder_only_if_empty_api(client, tmp_path):
    (tmp_path / "e").mkdir()
    (tmp_path / "f").mkdir()
    (tmp_path / "f" / "a.jpg").write_bytes(b"x")
    _put_root(client, tmp_path)
    body = {"path": str(tmp_path / "f"), "only_if_empty": True}
    r = client.post("/api/prune/delete-folder", json=body)
    assert r.status_code == 409 and r.json()["detail"] == "Folder is no longer empty"
    assert (tmp_path / "f" / "a.jpg").exists()
    body = {"path": str(tmp_path / "e"), "only_if_empty": True}
    assert client.post("/api/prune/delete-folder", json=body).status_code == 204
    assert not (tmp_path / "e").exists()


def test_details_missing_null_thumbnail_key_and_delete_cap(client, tmp_path, monkeypatch):
    from app.services import prune_files

    monkeypatch.setattr(
        prune_files,
        "probe_file",
        lambda p: {"streams": [{"codec_name": "h264"}], "format": {}},
    )
    prune_files.clear_details_cache()
    thumbs = tmp_path / "thumbs"
    monkeypatch.setattr(prune_files, "THUMB_DIR", str(thumbs))
    root = tmp_path / "root"
    root.mkdir()
    (root / "v.mp4").write_bytes(b"x")
    from PIL import Image

    Image.new("RGB", (40, 30), "red").save(root / "a.png")
    _put_root(client, root)
    v, gone = str(root / "v.mp4"), str(root / "gone.mp4")
    r = client.post("/api/prune/details", json={"paths": [v, gone]})
    assert r.status_code == 200
    d = r.json()["details"]
    assert d[v]["codec"] == "h264" and d[gone] is None

    for spelling in (f"{root}/a.png", f"{root}/./a.png", f"{root}//a.png"):
        assert client.get("/api/prune/thumbnail", params={"path": spelling}).status_code == 200
    assert len([n for n in os.listdir(thumbs) if n.endswith(".jpg")]) == 1

    paths = [str(root / f"{i}.jpg") for i in range(5001)]
    assert client.post("/api/prune/delete", json={"paths": paths}).status_code == 422


def test_thumbnail_endpoint_404_for_audio(client, tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"x")
    _put_root(client, tmp_path)
    assert (
        client.get("/api/prune/thumbnail", params={"path": str(tmp_path / "a.mp3")}).status_code
        == 404
    )
