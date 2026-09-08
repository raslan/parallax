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
