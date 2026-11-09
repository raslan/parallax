"""`_originals/` browse / restore / delete: these move and remove the user's actual files, so they
run against real files in a temp dir and a real (private) SQLite DB. Only the re-probe after a
restore (`rescan_fn`) and the stats write are stubbed."""

import os
from datetime import datetime

import pytest
from fastapi import HTTPException

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.file import File, FileStatus
from app.models.library import Library
from app.services import originals_common as oc
from app.services.audio_scanner import AUDIO_EXTENSIONS
from app.services.originals_common import OriginalsKind
from app.services.scanner import VIDEO_EXTENSIONS


@pytest.fixture
def rescans():
    return []


@pytest.fixture
def restores(monkeypatch):
    calls = []
    monkeypatch.setattr(oc.stats, "record_restore", lambda *a: calls.append(a))
    return calls


@pytest.fixture
def video_kind(rescans):
    return OriginalsKind(
        library_model=Library,
        file_model=File,
        rescan_fn=lambda db, f: rescans.append(f.path),
        route_prefix="/originals",
        extensions=VIDEO_EXTENSIONS,
    )


@pytest.fixture
def audio_kind(rescans):
    return OriginalsKind(
        library_model=AudioLibrary,
        file_model=AudioFile,
        rescan_fn=lambda db, f: rescans.append(f.path),
        route_prefix="/audio-originals",
        reset_at_field="compressed_at",
        media="audio",
        extensions=AUDIO_EXTENSIONS,
        dotted_extension=True,
    )


def _write(path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"x" * size)
    return str(path)


def _video_library(db, root):
    lib = Library(name="Movies", path=str(root))
    db.add(lib)
    db.commit()
    return lib


def _video_row(db, lib, path, size=100):
    row = File(
        library_id=lib.id,
        path=str(path),
        filename=os.path.basename(path),
        extension=os.path.splitext(path)[1].lower().lstrip("."),
        size=size,
        status=FileStatus.DONE,
        transcoded_at=datetime(2026, 1, 1),
    )
    db.add(row)
    db.commit()
    return row


@pytest.fixture
def db(fs_db):
    s = fs_db()
    yield s
    s.close()


# --- scan_library_originals / build_summary ---------------------------------


def test_entries_report_sizes_and_savings(db, video_kind, tmp_path):
    root = tmp_path / "lib"
    _write(root / "_originals" / "movie.mkv", 300)
    _write(root / "movie.mkv", 100)
    lib = _video_library(db, root)

    (entry,) = oc.scan_library_originals(video_kind, lib, db)

    assert entry["path"] == str(root / "_originals" / "movie.mkv")
    assert entry["current_path"] == str(root / "movie.mkv")
    assert (entry["original_size"], entry["current_size"], entry["savings_bytes"]) == (
        300,
        100,
        200,
    )
    assert (entry["library_id"], entry["library_name"]) == (lib.id, "Movies")


def test_a_changed_extension_is_matched_by_stem(db, video_kind, tmp_path):
    """webm in, mkv out: the current file is the same-stem file with another extension."""
    root = tmp_path / "lib"
    _write(root / "_originals" / "clip.webm", 500)
    _write(root / "clip.mkv", 200)
    lib = _video_library(db, root)

    (entry,) = oc.scan_library_originals(video_kind, lib, db)

    assert entry["current_path"] == str(root / "clip.mkv")
    assert entry["savings_bytes"] == 300


def test_a_subtitle_next_to_the_video_is_not_mistaken_for_the_current_file(
    db, video_kind, tmp_path
):
    """The re-encoded file is gone but `movie.srt` is still there: that is not 'the current
    file', and its few KB must not be reported as nearly the whole original saved."""
    root = tmp_path / "lib"
    _write(root / "_originals" / "movie.mkv", 5000)
    _write(root / "movie.srt", 40)
    _write(root / "movie.nfo", 10)
    lib = _video_library(db, root)

    (entry,) = oc.scan_library_originals(video_kind, lib, db)

    assert entry["current_path"] is None
    assert entry["current_size"] is None and entry["savings_bytes"] is None


def test_an_original_with_no_current_file_has_no_savings(db, video_kind, tmp_path):
    root = tmp_path / "lib"
    _write(root / "_originals" / "lost.mp4", 10)
    lib = _video_library(db, root)

    (entry,) = oc.scan_library_originals(video_kind, lib, db)

    assert entry["current_path"] is None and entry["savings_bytes"] is None


def test_nested_originals_folders_are_found_and_other_folders_ignored(db, video_kind, tmp_path):
    root = tmp_path / "lib"
    _write(root / "a" / "_originals" / "one.mp4", 10)
    _write(root / "a" / "one.mp4", 5)
    _write(root / "b" / "deeper" / "_originals" / "two.mp4", 20)
    _write(root / "b" / "not_originals" / "three.mp4", 30)
    lib = _video_library(db, root)

    entries = oc.scan_library_originals(video_kind, lib, db)

    assert sorted(os.path.basename(e["path"]) for e in entries) == ["one.mp4", "two.mp4"]


def test_a_library_whose_folder_is_gone_has_no_entries(db, video_kind, tmp_path):
    lib = _video_library(db, tmp_path / "unmounted")

    assert oc.scan_library_originals(video_kind, lib, db) == []


def test_summary_totals_skip_entries_without_a_current_file():
    entries = [
        {"original_size": 300, "current_size": 100, "savings_bytes": 200},
        {"original_size": 50, "current_size": None, "savings_bytes": None},
    ]

    assert oc.build_summary(entries) == {
        "entries": entries,
        "total_original_bytes": 350,
        "total_current_bytes": 100,
        "total_savings_bytes": 200,
    }


# --- delete_original --------------------------------------------------------


def test_delete_original_removes_the_backup_and_the_emptied_folder(db, tmp_path):
    root = tmp_path / "lib"
    backup = _write(root / "_originals" / "a.mp4", 10)

    oc.delete_original(db, backup)

    assert not os.path.exists(backup)
    assert not os.path.exists(root / "_originals")


def test_delete_original_keeps_a_folder_that_still_holds_other_backups(db, tmp_path):
    root = tmp_path / "lib"
    first = _write(root / "_originals" / "a.mp4", 10)
    second = _write(root / "_originals" / "b.mp4", 10)

    oc.delete_original(db, first)

    assert os.path.exists(second)


def test_delete_original_refuses_paths_outside_an_originals_folder(db, tmp_path):
    live = _write(tmp_path / "lib" / "movie.mp4", 10)

    with pytest.raises(HTTPException) as e:
        oc.delete_original(db, live)

    assert e.value.status_code == 400 and os.path.exists(live)


def test_delete_original_404s_for_a_missing_backup(db, tmp_path):
    with pytest.raises(HTTPException) as e:
        oc.delete_original(db, str(tmp_path / "lib" / "_originals" / "nope.mp4"))

    assert e.value.status_code == 404


def test_delete_original_cannot_be_walked_out_of_the_originals_folder(db, tmp_path):
    """`.../_originals/../movie.mp4` contains the text '/_originals/' but is the live file."""
    root = tmp_path / "lib"
    live = _write(root / "movie.mp4", 10)
    _write(root / "_originals" / "keep-this-dir-alive.mp4", 1)

    with pytest.raises(HTTPException) as e:
        oc.delete_original(db, str(root / "_originals" / ".." / "movie.mp4"))

    assert e.value.status_code == 400
    assert os.path.exists(live)


# --- restore_one ------------------------------------------------------------


def test_restore_replaces_the_current_file_and_resets_its_row(
    db, video_kind, rescans, restores, tmp_path
):
    root = tmp_path / "lib"
    backup = _write(root / "_originals" / "movie.mkv", 300)
    current = _write(root / "movie.mkv", 100)
    lib = _video_library(db, root)
    row = _video_row(db, lib, current)

    result = oc.restore_one(video_kind, db, backup)

    assert result == current
    assert os.path.getsize(current) == 300  # the original is back
    assert not os.path.exists(root / "_originals")  # emptied folder removed
    db.refresh(row)
    assert row.status == FileStatus.UNKNOWN and row.transcoded_at is None
    assert (row.path, row.filename, row.extension) == (current, "movie.mkv", "mkv")
    assert rescans == [current]
    assert restores == [("video", 300, 100)]


def test_restore_after_a_container_change_replaces_the_new_file_with_the_old(
    db, video_kind, rescans, restores, tmp_path
):
    root = tmp_path / "lib"
    backup = _write(root / "_originals" / "clip.webm", 500)
    transcoded = _write(root / "clip.mkv", 200)
    lib = _video_library(db, root)
    row = _video_row(db, lib, transcoded, size=200)

    result = oc.restore_one(video_kind, db, backup)

    assert result == str(root / "clip.webm")
    assert os.path.getsize(root / "clip.webm") == 500
    assert not os.path.exists(transcoded)
    db.refresh(row)
    assert (row.path, row.filename, row.extension) == (result, "clip.webm", "webm")
    assert restores == [("video", 500, 200)]


def test_restore_of_a_file_the_library_never_indexed_still_works(
    db, video_kind, rescans, restores, tmp_path
):
    root = tmp_path / "lib"
    backup = _write(root / "_originals" / "movie.mp4", 77)
    _video_library(db, root)

    result = oc.restore_one(video_kind, db, backup)

    assert os.path.getsize(result) == 77
    assert rescans == []  # no row to re-probe
    assert restores == [("video", 77, None)]


def test_restore_picks_the_right_row_when_another_name_differs_only_by_a_wildcard_character(
    db, video_kind, restores, tmp_path
):
    """`my movie.mp4` and `my_movie.mkv` side by side (the kind of near-duplicate this app
    exists to find). In a SQL LIKE, `_` matches any character, so the lookup for `my_movie.*`
    can return `my movie.mp4` and the restore would then delete that unrelated file."""
    root = tmp_path / "lib"
    unrelated = _write(root / "my movie.mp4", 60)
    transcoded = _write(root / "my_movie.mkv", 40)
    backup = _write(root / "_originals" / "my_movie.webm", 90)
    lib = _video_library(db, root)
    other_row = _video_row(db, lib, unrelated, size=60)  # inserted first: lower id
    row = _video_row(db, lib, transcoded, size=40)

    oc.restore_one(video_kind, db, backup)

    assert os.path.exists(unrelated)  # untouched
    assert not os.path.exists(transcoded)
    db.refresh(other_row)
    db.refresh(row)
    assert other_row.path == unrelated
    assert row.path == str(root / "my_movie.webm")


@pytest.mark.parametrize(
    "rel,status",
    [("movie.mp4", 400), ("_originals/missing.mp4", 404)],
)
def test_restore_validates_its_path(db, video_kind, tmp_path, rel, status):
    _write(tmp_path / "lib" / "movie.mp4", 5)

    with pytest.raises(HTTPException) as e:
        oc.restore_one(video_kind, db, str(tmp_path / "lib" / rel))

    assert e.value.status_code == status


def test_restore_cannot_be_walked_out_of_the_originals_folder(db, video_kind, tmp_path):
    root = tmp_path / "lib"
    live = _write(root / "movie.mp4", 10)
    _write(root / "_originals" / "other.mp4", 1)

    with pytest.raises(HTTPException) as e:
        oc.restore_one(video_kind, db, str(root / "_originals" / ".." / "movie.mp4"))

    assert e.value.status_code == 400 and os.path.exists(live)


def test_audio_restore_resets_compressed_at_and_keeps_the_dotted_extension(
    db, audio_kind, rescans, restores, tmp_path
):
    root = tmp_path / "music"
    backup = _write(root / "_originals" / "song.flac", 900)
    current = _write(root / "song.opus", 100)
    lib = AudioLibrary(name="Music", path=str(root))
    db.add(lib)
    db.commit()
    row = AudioFile(
        library_id=lib.id,
        path=current,
        filename="song.opus",
        extension=".opus",
        size=100,
        status=FileStatus.DONE,
        compressed_at=datetime(2026, 1, 1),
    )
    db.add(row)
    db.commit()

    oc.restore_one(audio_kind, db, backup)

    db.refresh(row)
    assert row.compressed_at is None and row.status == FileStatus.UNKNOWN
    assert (row.path, row.extension) == (str(root / "song.flac"), ".flac")
    assert restores == [("audio", 900, 100)]


# --- delete_library_originals -----------------------------------------------


def test_delete_library_originals_removes_every_backup_and_only_backups(db, video_kind, tmp_path):
    root = tmp_path / "lib"
    _write(root / "_originals" / "a.mp4", 10)
    _write(root / "sub" / "_originals" / "b.mp4", 10)
    live_a = _write(root / "a.mp4", 5)
    live_b = _write(root / "sub" / "b.mp4", 5)
    lib = _video_library(db, root)

    oc.delete_library_originals(video_kind, db, lib.id)

    assert not os.path.exists(root / "_originals")
    assert not os.path.exists(root / "sub" / "_originals")
    assert os.path.exists(live_a) and os.path.exists(live_b)


def test_delete_library_originals_404s_for_an_unknown_library(db, video_kind):
    with pytest.raises(HTTPException) as e:
        oc.delete_library_originals(video_kind, db, 999)

    assert e.value.status_code == 404
