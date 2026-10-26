import os
import sqlite3

import pytest
from sqlalchemy.orm import Session

from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.models.settings import Setting
from app.services.gallery_archive import archive_info, reset_archive


def _make_archive(path, entries=3):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE archive (entry TEXT PRIMARY KEY) WITHOUT ROWID")
    con.executemany("INSERT INTO archive VALUES (?)", [(f"e{i}",) for i in range(entries)])
    con.commit()
    con.close()


def test_archive_info_counts_entries(tmp_path):
    p = str(tmp_path / "a.sqlite3")
    _make_archive(p, 5)
    info = archive_info(p)
    assert info["exists"] is True and info["entries"] == 5 and info["size"] > 0


def test_archive_info_missing_file(tmp_path):
    info = archive_info(str(tmp_path / "nope.sqlite3"))
    assert info == {
        "path": str(tmp_path / "nope.sqlite3"),
        "exists": False,
        "size": 0,
        "entries": 0,
    }


def test_reset_removes_archive_and_sidecars(tmp_path):
    p = str(tmp_path / "a.sqlite3")
    _make_archive(p)
    for suffix in ("-wal", "-shm", "-journal"):
        (tmp_path / f"a.sqlite3{suffix}").write_bytes(b"x")
    assert reset_archive(p) is True
    assert os.listdir(tmp_path) == []
    assert reset_archive(p) is False  # nothing left to delete


def test_reset_refuses_a_file_that_is_not_sqlite(tmp_path):
    precious = tmp_path / "movie.mkv"
    precious.write_bytes(b"not a database")
    with pytest.raises(ValueError):
        reset_archive(str(precious))
    assert precious.exists()


@pytest.fixture
def _clean(engine):
    with Session(engine) as s:
        s.query(GalleryDownload).delete()
        s.query(Setting).filter(Setting.key == "gallery_options").delete()
        s.commit()
    yield


def _set_archive(client, path):
    client.put(
        "/api/galleries/options",
        json={**client.get("/api/galleries/options").json(), "archivePath": path},
    )


def test_archive_routes_info_and_reset(client, tmp_path, _clean):
    p = str(tmp_path / "a.sqlite3")
    _make_archive(p, 4)
    _set_archive(client, p)

    assert client.get("/api/galleries/archive").json()["entries"] == 4
    r = client.post("/api/galleries/archive/reset")
    assert r.status_code == 200 and r.json()["exists"] is False
    assert not os.path.exists(p)


def test_archive_reset_is_409_while_a_gallery_is_active(client, engine, tmp_path, _clean):
    p = str(tmp_path / "a.sqlite3")
    _make_archive(p)
    _set_archive(client, p)
    with Session(engine) as s:
        s.add(
            GalleryDownload(
                url="https://x/1", status=GalleryDownloadStatus.RUNNING, output_dir="/tmp/x"
            )
        )
        s.commit()
    assert client.post("/api/galleries/archive/reset").status_code == 409
    assert os.path.exists(p)


def test_archive_reset_400_for_non_sqlite_custom_path(client, tmp_path, _clean):
    bogus = tmp_path / "notes.txt"
    bogus.write_text("hello")
    _set_archive(client, str(bogus))
    assert client.post("/api/galleries/archive/reset").status_code == 400
    assert bogus.exists()
