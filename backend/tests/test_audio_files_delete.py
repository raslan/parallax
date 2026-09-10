import pytest
from sqlalchemy.orm import sessionmaker

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary


@pytest.fixture
def seeded(engine, tmp_path):
    Session = sessionmaker(bind=engine)
    db = Session()
    lib = AudioLibrary(name="L", path=str(tmp_path))
    db.add(lib)
    db.commit()

    def mk(name: str) -> int:
        p = tmp_path / name
        p.write_bytes(b"data")
        row = AudioFile(
            library_id=lib.id,
            path=str(p),
            filename=name,
            extension=".mp3",
            size=4,
        )
        db.add(row)
        db.commit()
        return row.id

    ids = {"a": mk("a.mp3"), "b": mk("b.mp3"), "c": mk("c.mp3")}
    db.close()
    return tmp_path, lib, ids


def test_delete_keep_original_moves_to_originals(client, seeded, engine):
    tmp_path, _lib, ids = seeded
    r = client.post("/api/audio-files/delete", json={"file_ids": [ids["a"]]})
    assert r.status_code == 204
    assert not (tmp_path / "a.mp3").exists()
    assert (tmp_path / "_originals" / "a.mp3").exists()

    Session = sessionmaker(bind=engine)
    db = Session()
    assert db.get(AudioFile, ids["a"]) is None
    db.close()


def test_delete_hard_removes_file(client, seeded):
    tmp_path, _lib, ids = seeded
    r = client.post(
        "/api/audio-files/delete",
        json={"file_ids": [ids["b"]], "keep_original": False},
    )
    assert r.status_code == 204
    assert not (tmp_path / "b.mp3").exists()
    assert not (tmp_path / "_originals").exists()


def test_delete_collision_suffixes_with_id(client, seeded):
    tmp_path, _lib, ids = seeded
    originals = tmp_path / "_originals"
    originals.mkdir()
    (originals / "c.mp3").write_bytes(b"old")  # pre-existing name collision

    r = client.post("/api/audio-files/delete", json={"file_ids": [ids["c"]]})
    assert r.status_code == 204
    assert (originals / "c.mp3").read_bytes() == b"old"  # untouched
    assert (originals / f"c_{ids['c']}.mp3").exists()


def test_delete_skips_unknown_ids(client, seeded):
    _tmp, _lib, ids = seeded
    r = client.post(
        "/api/audio-files/delete",
        json={"file_ids": [ids["a"], 999999]},
    )
    assert r.status_code == 204
