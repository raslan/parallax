import pytest
from sqlalchemy.orm import Session

from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.models.settings import Setting


@pytest.fixture(autouse=True)
def _clean_gallery_state(engine):
    """Route tests read through the ``client`` fixture's ``get_db`` override
    (bound to the test engine), and nothing rolls the test engine back between
    tests. Wipe gallery rows + the persisted options blob so each test starts
    from a known-empty state regardless of ordering."""
    with Session(engine) as s:
        s.query(GalleryDownload).delete()
        s.query(Setting).filter(Setting.key == "gallery_options").delete()
        s.commit()
    yield


def test_orphan_sweep_marks_running_and_pending_as_failed(engine):
    from app.database import SessionLocal, init_db
    from app.main import _reap_orphaned_galleries

    # Ensure the real SessionLocal engine (transcoder.db under DATA_DIR) has the
    # gallery_downloads table — _reap_orphaned_galleries opens its own session.
    init_db()

    ids = []
    s = SessionLocal()
    try:
        for st in (GalleryDownloadStatus.RUNNING, GalleryDownloadStatus.PENDING):
            row = GalleryDownload(url=f"https://example.com/{st}", status=st, output_dir="/tmp/x")
            s.add(row)
            s.flush()
            ids.append(row.id)
        s.commit()
    finally:
        s.close()

    _reap_orphaned_galleries()

    s = SessionLocal()
    try:
        for i in ids:
            r = s.get(GalleryDownload, i)
            assert r.status == GalleryDownloadStatus.FAILED
            assert "restart" in (r.error or "").lower()
            s.delete(r)
        s.commit()
    finally:
        s.close()


def test_enqueue_requires_base_dir(client):
    r = client.post("/api/galleries", json={"urls": ["https://x.com/g/1"]})
    assert r.status_code == 400
    assert "base directory" in r.json()["detail"].lower()


def test_options_roundtrip(client):
    got = client.get("/api/galleries/options").json()
    assert got["maxParallel"] == 2
    got["baseDir"] = "/media/g"
    got["retries"] = 7
    assert client.put("/api/galleries/options", json=got).status_code == 200
    assert client.get("/api/galleries/options").json()["retries"] == 7


def test_options_rejects_bad_blob(client):
    r = client.put("/api/galleries/options", json={"maxParallel": 99})
    assert r.status_code == 422


def test_enqueue_creates_rows(client, monkeypatch):
    import app.api.galleries as mod

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(mod, "run_gallery", _noop)  # don't spawn real work
    client.put(
        "/api/galleries/options",
        json={**client.get("/api/galleries/options").json(), "baseDir": "/tmp/g"},
    )
    r = client.post("/api/galleries", json={"urls": ["https://x.com/a", "https://x.com/b"]})
    assert r.status_code == 200
    assert len(r.json()["ids"]) == 2
    rows = client.get("/api/galleries").json()
    assert len(rows) == 2
    assert all(row["status"] == "pending" for row in rows)


def test_enqueue_file_mode_expands_urls_to_paste_rows(client, engine, monkeypatch, tmp_path):
    import app.api.galleries as mod
    from app.schemas import GalleryOptions

    async def _noop(*a, **k):
        return None

    import app.services.gallery_urllists as lists

    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(tmp_path / "none.txt"))
    lists.write_list("mine", "https://x.com/a\n\n# skipped\n  https://youtube.com/@b  \n")
    lists.write_list("other", "https://x.com/not-this-one\n")
    monkeypatch.setattr(mod, "run_gallery", _noop)
    client.put(
        "/api/galleries/options",
        json={
            **client.get("/api/galleries/options").json(),
            "baseDir": "/tmp/g",
            "inputMode": "file",
            "urlList": "mine",
        },
    )
    r = client.post("/api/galleries", json={"urls": []})
    assert r.status_code == 200
    assert len(r.json()["ids"]) == 2
    rows = sorted(client.get("/api/galleries").json(), key=lambda x: x["id"])
    assert [x["url"] for x in rows] == ["https://x.com/a", "https://youtube.com/@b"]
    with Session(engine) as s:
        snap = s.query(GalleryDownload).first().options
    assert GalleryOptions.model_validate_json(snap).inputMode == "paste"


def test_enqueue_file_mode_missing_or_empty_list_is_400(client, monkeypatch, tmp_path):
    import app.services.gallery_urllists as lists

    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(tmp_path / "none.txt"))

    def opts(name):
        client.put(
            "/api/galleries/options",
            json={
                **client.get("/api/galleries/options").json(),
                "baseDir": "/tmp/g",
                "inputMode": "file",
                "urlList": name,
            },
        )

    opts("nope")
    r = client.post("/api/galleries", json={"urls": []})
    assert r.status_code == 400 and "not found" in r.json()["detail"]
    lists.write_list("blank", "\n# only a comment\n")
    opts("blank")
    assert client.post("/api/galleries", json={"urls": []}).status_code == 400


def test_urllists_crud_and_rename(client, monkeypatch, tmp_path):
    import app.services.gallery_urllists as lists

    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(tmp_path / "none.txt"))

    assert client.get("/api/galleries/urllists").json() == {"lists": []}
    assert client.put("/api/galleries/urllists/b", json={"text": "https://a\n# c\nhttps://b\n"})
    client.put("/api/galleries/urllists/A list", json={"text": ""})
    got = client.get("/api/galleries/urllists").json()["lists"]
    assert got == [{"name": "A list", "count": 0}, {"name": "b", "count": 2}]
    assert client.get("/api/galleries/urllists/b").json()["text"].startswith("https://a")

    r = client.post("/api/galleries/urllists/b/rename", json={"name": "renamed"})
    assert r.json() == {"name": "renamed"}
    assert client.get("/api/galleries/urllists/b").status_code == 404
    # renaming onto an existing list never overwrites it
    assert (
        client.post("/api/galleries/urllists/renamed/rename", json={"name": "A list"}).status_code
        == 409
    )

    assert client.delete("/api/galleries/urllists/renamed").status_code == 204
    assert client.delete("/api/galleries/urllists/renamed").status_code == 404


@pytest.mark.parametrize("bad", ["..", ".hidden", "a/b", "x" * 65, " ", "trail."])
def test_urllists_reject_names_that_are_not_plain_filenames(client, monkeypatch, tmp_path, bad):
    import app.services.gallery_urllists as lists

    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(tmp_path / "none.txt"))
    r = client.put(f"/api/galleries/urllists/{bad}", json={"text": "x"})
    assert r.status_code in (400, 404, 405)  # "a/b" never reaches the route
    assert not (tmp_path / "x").exists()
    assert list((tmp_path / "lists").glob("*")) == [] if (tmp_path / "lists").exists() else True


def test_legacy_urls_txt_seeds_the_default_list_once(tmp_path, monkeypatch):
    import app.services.gallery_urllists as lists

    legacy = tmp_path / "urls.txt"
    legacy.write_text("https://old/1\nhttps://old/2\n")
    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(legacy))

    assert lists.list_lists() == [{"name": "default", "count": 2}]
    assert legacy.exists()  # copied, not moved: legacy `-i urls.txt` history rows still use it
    # a later edit to the new list isn't clobbered by a re-migration
    lists.write_list("default", "https://new\n")
    assert lists.list_lists() == [{"name": "default", "count": 1}]


def test_legacy_file_still_seeds_default_when_a_list_is_created_first(tmp_path, monkeypatch):
    import app.services.gallery_urllists as lists

    legacy = tmp_path / "urls.txt"
    legacy.write_text("https://old/1\n")
    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(legacy))

    lists.write_list("fresh", "https://new\n")  # nothing has listed the lists yet
    assert lists.list_lists() == [
        {"name": "default", "count": 1},
        {"name": "fresh", "count": 1},
    ]
    assert lists.read_urls("default") == ["https://old/1"]


def test_deleting_every_list_does_not_resurrect_the_legacy_file(tmp_path, monkeypatch):
    import app.services.gallery_urllists as lists

    legacy = tmp_path / "urls.txt"
    legacy.write_text("https://old/1\n")
    monkeypatch.setattr(lists, "LISTS_DIR", str(tmp_path / "lists"))
    monkeypatch.setattr(lists, "LEGACY_FILE", str(legacy))

    assert [x["name"] for x in lists.list_lists()] == ["default"]
    lists.delete_list("default")
    assert lists.list_lists() == []
    assert legacy.read_text() == "https://old/1\n"  # untouched on disk


def test_gdl_update_failure_returns_502(client, monkeypatch):
    import app.api.galleries as mod

    def _boom():
        raise RuntimeError("pip install failed (exit 1): No matching distribution")

    monkeypatch.setattr(mod, "install_gallerydl", _boom)
    r = client.post("/api/galleries/gdl/update")
    assert r.status_code == 502
    assert "update failed" in r.json()["detail"]


def test_clear_only_terminal(client, engine):
    with Session(engine) as s:
        s.add(GalleryDownload(url="a", status=GalleryDownloadStatus.COMPLETED, output_dir="/x"))
        s.add(GalleryDownload(url="b", status=GalleryDownloadStatus.RUNNING, output_dir="/x"))
        s.commit()
    r = client.post("/api/galleries/clear", json={"statuses": ["completed", "running"]})
    assert r.json()["cleared"] == 1
    assert len(client.get("/api/galleries").json()) == 1
