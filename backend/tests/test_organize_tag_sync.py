"""After Organize writes tags, a library that contains the file is told (the same nudge Splice
and Upscale give the watcher) and a video's cached byte hash is cleared. It never raises."""

import os

from app.models.audio_library import AudioLibrary
from app.models.file import File
from app.models.image_library import ImageLibrary
from app.models.library import Library
from app.services import fs_watcher, organize_tag_sync


def _library(factory, model, path):
    db = factory()
    lib = model(name="l", path=str(path))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()
    return lib_id


def _recorder(monkeypatch):
    calls = []
    monkeypatch.setattr(
        fs_watcher, "_apply", lambda kind, lib_id, changed: calls.append((kind, lib_id, changed))
    )
    return calls


def test_a_written_file_nudges_the_library_that_contains_it(fs_db, tmp_path, monkeypatch):
    (tmp_path / "v").mkdir()
    vid = _library(fs_db, Library, tmp_path / "v")
    aid = _library(fs_db, AudioLibrary, tmp_path / "a")
    iid = _library(fs_db, ImageLibrary, tmp_path / "i")
    calls = _recorder(monkeypatch)
    paths = [
        str(tmp_path / "v" / "sub" / "x.mkv"),
        str(tmp_path / "a" / "s.mp3"),
        str(tmp_path / "i" / "p.jpg"),
        str(tmp_path / "elsewhere" / "z.mp3"),
    ]
    organize_tag_sync.refresh_libraries(paths)
    assert sorted(calls, key=lambda c: c[0]) == [
        ("audio", aid, frozenset({paths[1]})),
        ("image", iid, frozenset({paths[2]})),
        ("video", vid, frozenset({paths[0]})),
    ]


def test_several_files_of_one_library_go_in_one_nudge(fs_db, tmp_path, monkeypatch):
    lib = _library(fs_db, AudioLibrary, tmp_path / "a")
    calls = _recorder(monkeypatch)
    a, b = str(tmp_path / "a" / "1.mp3"), str(tmp_path / "a" / "2.flac")
    organize_tag_sync.refresh_libraries([a, b])
    assert calls == [("audio", lib, frozenset({a, b}))]


def test_a_sibling_folder_with_the_same_prefix_is_not_inside_the_library(
    fs_db, tmp_path, monkeypatch
):
    _library(fs_db, AudioLibrary, tmp_path / "music")
    calls = _recorder(monkeypatch)
    organize_tag_sync.refresh_libraries([str(tmp_path / "music-old" / "s.mp3")])
    assert calls == []


def test_a_file_of_the_wrong_kind_for_the_library_is_not_nudged(fs_db, tmp_path, monkeypatch):
    _library(fs_db, Library, tmp_path / "v")
    calls = _recorder(monkeypatch)
    organize_tag_sync.refresh_libraries([str(tmp_path / "v" / "song.mp3")])
    assert calls == []


def test_a_videos_cached_byte_hash_is_cleared(fs_db, tmp_path, monkeypatch):
    lib = _library(fs_db, Library, tmp_path / "v")
    db = fs_db()
    p = str(tmp_path / "v" / "x.mkv")
    other = str(tmp_path / "v" / "y.mkv")
    db.add_all(
        [
            File(library_id=lib, path=p, filename="x.mkv", byte_hash="a" * 32, phash=5),
            File(library_id=lib, path=other, filename="y.mkv", byte_hash="b" * 32),
        ]
    )
    db.commit()
    db.close()
    _recorder(monkeypatch)
    organize_tag_sync.refresh_libraries([p])
    db = fs_db()
    rows = {f.path: f for f in db.query(File).all()}
    db.close()
    assert rows[p].byte_hash is None
    assert rows[p].phash == 5  # frames did not change, so the pHash stays
    assert rows[other].byte_hash == "b" * 32


def test_a_failing_nudge_never_raises(fs_db, tmp_path, monkeypatch):
    _library(fs_db, Library, tmp_path / "v")

    def boom(*a):
        raise RuntimeError("watcher exploded")

    monkeypatch.setattr(fs_watcher, "_apply", boom)
    organize_tag_sync.refresh_libraries([str(tmp_path / "v" / "x.mkv")])  # no exception


def test_a_failing_database_never_raises(tmp_path, monkeypatch):
    import app.database

    def broken():
        raise RuntimeError("no database")

    monkeypatch.setattr(app.database, "SessionLocal", broken)
    organize_tag_sync.refresh_libraries([str(tmp_path / "x.mkv")])  # no exception
    assert os.path.isdir(tmp_path)


def test_no_paths_does_nothing(fs_db, monkeypatch):
    calls = _recorder(monkeypatch)
    organize_tag_sync.refresh_libraries([])
    assert calls == []
