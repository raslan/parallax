"""Video library routes: create, delete (and everything the delete must clean up), leftovers, the
two bulk removals (Cleanup / Duplicates), browse, and the job triggers. Real files in a temp dir,
the real app through `TestClient`; the watcher, stats and job queue are recorded by `lib_env`."""

import os

import pytest

from app.models.file import File, FileStatus
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.models.schedule import Schedule
from app.services import common, scanner

API = "/api/libraries"


def _write(path, size=10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"x" * size)
    return str(path)


def _library(env, path, name="Movies"):
    s = env.Session()
    lib = Library(name=name, path=str(path))
    s.add(lib)
    s.commit()
    lib_id = lib.id
    s.close()
    return lib_id


def _file(env, lib_id, path, size=10, status=FileStatus.DONE):
    s = env.Session()
    row = File(
        library_id=lib_id,
        path=str(path),
        filename=os.path.basename(path),
        extension=os.path.splitext(path)[1].lstrip("."),
        size=size,
        status=status,
    )
    s.add(row)
    s.commit()
    row_id = row.id
    s.close()
    return row_id


def _file_ids(env, lib_id):
    s = env.Session()
    try:
        return sorted(r.id for r in s.query(File).filter(File.library_id == lib_id))
    finally:
        s.close()


# --- create -----------------------------------------------------------------


def test_create_registers_the_library_and_starts_watching_it(lib_env):
    root = lib_env.root / "movies"
    root.mkdir()

    r = lib_env.client.post(API, json={"name": "Movies", "path": str(root)})

    assert r.status_code == 201
    (lib,) = r.json()
    assert (lib["name"], lib["path"]) == ("Movies", str(root))
    assert lib_env.events == [("watch", "video", lib["id"])]


def test_create_rejects_a_missing_folder_and_a_file(lib_env):
    f = _write(lib_env.root / "afile.txt")

    for path in (str(lib_env.root / "nope"), f):
        r = lib_env.client.post(API, json={"name": "x", "path": path})
        assert r.status_code == 400, path
    assert lib_env.events == []


def test_create_rejects_the_same_folder_twice_even_spelled_differently(lib_env):
    root = lib_env.root / "movies"
    root.mkdir()
    assert lib_env.client.post(API, json={"name": "a", "path": str(root)}).status_code == 201

    for spelling in (str(root), str(root) + "/", str(root) + "/."):
        r = lib_env.client.post(API, json={"name": "b", "path": spelling})
        assert r.status_code == 400, spelling


def test_create_rejects_a_folder_inside_or_around_an_existing_library(lib_env):
    """`files.path` is unique across all video libraries, so two libraries that both cover a
    folder cannot both index it: the second scan fails on UNIQUE(path) and the watcher logs the
    same error on every sweep, forever."""
    outer = lib_env.root / "media"
    inner = outer / "movies"
    inner.mkdir(parents=True)
    other = lib_env.root / "media2"  # shares a name prefix but is a different folder
    other.mkdir()
    assert lib_env.client.post(API, json={"name": "outer", "path": str(outer)}).status_code == 201

    inside = lib_env.client.post(API, json={"name": "inner", "path": str(inner)})
    sibling = lib_env.client.post(API, json={"name": "other", "path": str(other)})

    assert inside.status_code == 400 and "overlaps" in inside.json()["detail"]
    assert sibling.status_code == 201  # 'media2' is not inside 'media'

    parent_of = lib_env.client.post(API, json={"name": "up", "path": str(lib_env.root)})
    assert parent_of.status_code == 400


def test_split_creates_one_library_per_visible_subfolder(lib_env):
    for name in ("Action", "Drama", ".hidden"):
        (lib_env.root / "all" / name).mkdir(parents=True)
    _write(lib_env.root / "all" / "loose-file.mp4")  # a file is not a subfolder

    r = lib_env.client.post(
        API, json={"path": str(lib_env.root / "all"), "split_into_sublibraries": True}
    )

    assert r.status_code == 201
    assert sorted(lib["name"] for lib in r.json()) == ["Action", "Drama"]
    assert [e[0] for e in lib_env.events] == ["watch", "watch"]


def test_split_skips_subfolders_that_already_have_a_library(lib_env):
    for name in ("Action", "Drama"):
        (lib_env.root / "all" / name).mkdir(parents=True)
    _library(lib_env, lib_env.root / "all" / "Action")

    r = lib_env.client.post(
        API, json={"path": str(lib_env.root / "all"), "split_into_sublibraries": True}
    )

    assert [lib["name"] for lib in r.json()] == ["Drama"]


def test_split_errors(lib_env):
    empty = lib_env.root / "empty"
    empty.mkdir()
    body = {"split_into_sublibraries": True}

    assert lib_env.client.post(API, json={**body, "path": str(empty)}).status_code == 422
    missing = lib_env.client.post(API, json={**body, "path": str(lib_env.root / "gone")})
    assert missing.status_code == 400


# --- read / update ----------------------------------------------------------


def test_list_get_and_update(lib_env):
    root = lib_env.root / "m"
    root.mkdir()
    lib_id = _library(lib_env, root)
    _file(lib_env, lib_id, _write(root / "a.mp4"))

    listed = lib_env.client.get(API).json()
    assert [(lib["id"], lib["file_count"]) for lib in listed] == [(lib_id, 1)]
    assert lib_env.client.get(f"{API}/{lib_id}").json()["name"] == "Movies"

    r = lib_env.client.patch(f"{API}/{lib_id}", json={"name": "Films"})
    assert r.status_code == 200 and r.json()["name"] == "Films"
    assert lib_env.client.get(f"{API}/999").status_code == 404
    assert lib_env.client.patch(f"{API}/999", json={"name": "x"}).status_code == 404


# --- leftovers --------------------------------------------------------------


def test_leftovers_counts_backups_in_every_originals_folder(lib_env):
    root = lib_env.root / "m"
    _write(root / "_originals" / "a.mp4", 100)
    _write(root / "sub" / "_originals" / "b.mp4", 50)
    _write(root / "keep.mp4", 999)  # live media is not a leftover
    lib_id = _library(lib_env, root)

    body = lib_env.client.get(f"{API}/{lib_id}/leftovers").json()

    assert body == {"has_leftovers": True, "dir_name": "_originals", "count": 2, "total_bytes": 150}


def test_leftovers_when_there_are_none_and_for_an_unknown_library(lib_env):
    root = lib_env.root / "m"
    root.mkdir()
    lib_id = _library(lib_env, root)

    assert lib_env.client.get(f"{API}/{lib_id}/leftovers").json()["has_leftovers"] is False
    assert lib_env.client.get(f"{API}/999/leftovers").status_code == 404


# --- delete -----------------------------------------------------------------


def test_delete_removes_rows_thumbnails_markers_and_schedules_but_never_the_media(lib_env):
    root = lib_env.root / "m"
    media = _write(root / "a.mp4")
    lib_id = _library(lib_env, root)
    file_id = _file(lib_env, lib_id, media)
    _write(lib_env.thumbs / f"{file_id}.jpg")
    _write(lib_env.thumbs / f"{file_id}.jpg.failed")
    s = lib_env.Session()
    s.add(Schedule(library_id=lib_id, job_type=JobType.SCAN, cron_expr="0 3 * * *"))
    s.commit()
    s.close()

    r = lib_env.client.delete(f"{API}/{lib_id}")

    assert r.status_code == 204
    s = lib_env.Session()
    assert s.get(Library, lib_id) is None
    assert s.query(File).count() == 0 and s.query(Schedule).count() == 0
    s.close()
    assert not os.path.exists(lib_env.thumbs / f"{file_id}.jpg")
    assert not os.path.exists(lib_env.thumbs / f"{file_id}.jpg.failed")
    assert os.path.exists(media)  # deleting a library never touches the user's files


def test_delete_stops_the_watcher_before_anything_else(lib_env):
    root = lib_env.root / "m"
    root.mkdir()
    lib_id = _library(lib_env, root)

    lib_env.client.delete(f"{API}/{lib_id}")

    assert lib_env.events == [("unwatch", "video", lib_id)]


def test_delete_keeps_originals_unless_asked_and_then_removes_only_those(lib_env):
    root = lib_env.root / "m"
    live = _write(root / "a.mp4")
    backup = _write(root / "_originals" / "a.mp4")
    nested = _write(root / "sub" / "_originals" / "b.mp4")
    lib_id = _library(lib_env, root)
    other_id = _library(lib_env, lib_env.root / "other", name="Other")

    lib_env.client.delete(f"{API}/{lib_id}")
    assert os.path.exists(backup) and os.path.exists(nested)  # default: kept on disk

    lib_env.client.delete(f"{API}/{other_id}?delete_leftovers=true")
    assert os.path.exists(backup)  # a different library's delete must not reach them

    again = _library(lib_env, root, name="Movies again")
    lib_env.client.delete(f"{API}/{again}?delete_leftovers=true")
    assert not os.path.exists(root / "_originals")
    assert not os.path.exists(root / "sub" / "_originals")
    assert os.path.exists(live)


def test_delete_cancels_and_detaches_its_own_running_jobs(lib_env):
    root = lib_env.root / "m"
    root.mkdir()
    lib_id = _library(lib_env, root)
    s = lib_env.Session()
    running = Job(type=JobType.SCAN, status=JobStatus.RUNNING, library_id=lib_id)
    done = Job(type=JobType.SCAN, status=JobStatus.COMPLETED, library_id=lib_id)
    s.add_all([running, done])
    s.commit()
    running_id, done_id = running.id, done.id
    s.close()

    lib_env.client.delete(f"{API}/{lib_id}")

    try:
        assert common.should_cancel(running_id)
        assert not common.should_cancel(done_id)
        s = lib_env.Session()
        assert s.get(Job, running_id).library_id is None  # history stays, detached
        assert s.get(Job, done_id).library_id is None
        s.close()
    finally:
        common.clear_cancel(running_id)


def test_delete_leaves_another_kinds_jobs_with_the_same_library_id_alone(lib_env):
    """Video, image and audio library ids all count from 1 and `Job` has no kind column. Deleting
    video library 7 must not cancel the running scan of *image* library 7, nor detach its job."""
    s = lib_env.Session()
    s.add(Library(id=7, name="V", path=str(lib_env.root / "v")))
    s.add(ImageLibrary(id=7, name="I", path=str(lib_env.root / "i")))
    image_scan = Job(type=JobType.IMAGE_SCAN, status=JobStatus.RUNNING, library_id=7)
    s.add(image_scan)
    s.commit()
    image_scan_id = image_scan.id
    s.close()

    lib_env.client.delete(f"{API}/7")

    try:
        assert not common.should_cancel(image_scan_id)
        s = lib_env.Session()
        assert s.get(Job, image_scan_id).library_id == 7
        s.close()
    finally:
        common.clear_cancel(image_scan_id)


def test_delete_unknown_library_404s(lib_env):
    assert lib_env.client.delete(f"{API}/999").status_code == 404


# --- bulk removal: Cleanup and Duplicates -----------------------------------


@pytest.fixture(params=["cleanup", "duplicates"])
def removal(request, lib_env):
    """Both routes do the same job: move the files into `_originals/` and forget the rows."""

    def call(lib_id, ids):
        return lib_env.client.request(
            "DELETE", f"{API}/{lib_id}/{request.param}", json={"file_ids": ids}
        )

    return call


def _library_with_files(env, *names, size=10):
    root = env.root / "m"
    lib_id = _library(env, root)
    ids = [_file(env, lib_id, _write(root / n, size), size=size) for n in names]
    return root, lib_id, ids


def test_removal_moves_files_to_originals_forgets_rows_and_credits_stats(lib_env, removal):
    root, lib_id, (a, b, keep) = _library_with_files(lib_env, "a.mp4", "b.mp4", "keep.mp4", size=40)
    _write(lib_env.thumbs / f"{a}.jpg")

    assert removal(lib_id, [a, b]).status_code == 204

    assert (root / "_originals" / "a.mp4").exists() and (root / "_originals" / "b.mp4").exists()
    assert not (root / "a.mp4").exists() and (root / "keep.mp4").exists()
    assert _file_ids(lib_env, lib_id) == [keep]
    assert not os.path.exists(lib_env.thumbs / f"{a}.jpg")
    assert lib_env.removals == [("video", 2, 80)]


def test_removal_never_overwrites_an_existing_backup(lib_env, removal):
    """An earlier removal left `_originals/movie.mp4`; a new `movie.mp4` shows up and is removed
    too. The old backup is the only copy of that older file."""
    root, lib_id, (movie,) = _library_with_files(lib_env, "movie.mp4")
    _write(root / "_originals" / "movie.mp4", 3)  # the earlier backup, different content

    assert removal(lib_id, [movie]).status_code == 204

    backups = sorted(os.listdir(root / "_originals"))
    assert len(backups) == 2
    assert (root / "_originals" / "movie.mp4").stat().st_size == 3  # untouched
    assert not (root / "movie.mp4").exists()


def test_removal_survives_repeated_name_collisions(lib_env, removal):
    root, lib_id, (movie,) = _library_with_files(lib_env, "movie.mp4")
    _write(root / "_originals" / "movie.mp4", 1)
    _write(root / "_originals" / f"movie_{movie}.mp4", 2)  # even the id-suffixed name is taken

    assert removal(lib_id, [movie]).status_code == 204

    sizes = sorted(p.stat().st_size for p in (root / "_originals").iterdir())
    assert sizes == [1, 2, 10]  # three distinct files, none lost


def test_removal_ignores_unknown_ids_and_files_of_other_libraries(lib_env, removal):
    root, lib_id, (mine,) = _library_with_files(lib_env, "mine.mp4")
    other_root = lib_env.root / "other"
    other_lib = _library(lib_env, other_root, name="Other")
    theirs = _file(lib_env, other_lib, _write(other_root / "theirs.mp4"))

    assert removal(lib_id, [mine, theirs, 99999]).status_code == 204

    assert (other_root / "theirs.mp4").exists()
    assert _file_ids(lib_env, other_lib) == [theirs]
    assert lib_env.removals == [("video", 1, 10)]


def test_removing_a_file_that_is_already_gone_forgets_the_row_without_crediting(lib_env, removal):
    root, lib_id, (gone,) = _library_with_files(lib_env, "gone.mp4")
    os.remove(root / "gone.mp4")

    assert removal(lib_id, [gone]).status_code == 204

    assert _file_ids(lib_env, lib_id) == []
    assert lib_env.removals == [("video", 0, 0)]


def test_one_file_that_cannot_be_moved_does_not_strand_the_others(lib_env, removal, monkeypatch):
    """A read-only folder, a permissions error: the files that did move must be forgotten (their
    rows would otherwise point at paths that no longer exist) and the failure must be reported,
    not swallowed and not a crash half-way."""
    import shutil

    root, lib_id, (a, b, c) = _library_with_files(lib_env, "a.mp4", "b.mp4", "c.mp4")
    real_move = shutil.move

    def flaky(src, dst):
        if src.endswith("b.mp4"):
            raise PermissionError("read-only")
        return real_move(src, dst)

    monkeypatch.setattr(shutil, "move", flaky)

    r = removal(lib_id, [a, b, c])

    assert r.status_code == 500 and "b.mp4" in r.json()["detail"]
    assert (root / "b.mp4").exists()  # still there, still indexed
    assert _file_ids(lib_env, lib_id) == [b]
    assert not (root / "a.mp4").exists() and not (root / "c.mp4").exists()
    assert lib_env.removals == [("video", 2, 20)]


def test_removal_404s_for_an_unknown_library(lib_env, removal):
    assert removal(999, [1]).status_code == 404


# --- cleanup listing --------------------------------------------------------


def test_cleanup_lists_only_files_still_on_disk_and_needs_an_indexed_library(lib_env):
    root, lib_id, (a, gone) = _library_with_files(lib_env, "a.mp4", "gone.mp4")
    os.remove(root / "gone.mp4")

    ids = [f["id"] for f in lib_env.client.get(f"{API}/{lib_id}/cleanup").json()]
    assert ids == [a]

    empty = _library(lib_env, lib_env.root / "empty", name="Empty")
    assert lib_env.client.get(f"{API}/{empty}/cleanup").status_code == 422
    assert lib_env.client.get(f"{API}/999/cleanup").status_code == 404


# --- browse -----------------------------------------------------------------


def _browse(env, lib_id, **params):
    return env.client.get(f"{API}/{lib_id}/browse", params=params).json()


def test_browse_lists_direct_files_and_subfolders(lib_env):
    root = lib_env.root / "m"
    lib_id = _library(lib_env, root)
    for rel in ("top.mp4", "Action/a.mp4", "Action/Sub/deep.mp4", "Drama/d.mp4"):
        _file(lib_env, lib_id, _write(root / rel))

    top = _browse(lib_env, lib_id)
    assert [f["filename"] for f in top["files"]] == ["top.mp4"]
    assert top["dirs"] == ["Action", "Drama"]

    action = _browse(lib_env, lib_id, path="Action")
    assert [f["filename"] for f in action["files"]] == ["a.mp4"]
    assert action["dirs"] == ["Sub"]


def test_browse_sorts_and_filters(lib_env):
    root = lib_env.root / "m"
    lib_id = _library(lib_env, root)
    _file(lib_env, lib_id, _write(root / "b.mp4"), size=5, status=FileStatus.DONE)
    _file(lib_env, lib_id, _write(root / "a.mp4"), size=50, status=FileStatus.FAILED)

    assert [f["filename"] for f in _browse(lib_env, lib_id)["files"]] == ["a.mp4", "b.mp4"]
    by_size = _browse(lib_env, lib_id, sort_by="size", sort_dir="desc")
    assert [f["filename"] for f in by_size["files"]] == ["a.mp4", "b.mp4"]
    only_failed = _browse(lib_env, lib_id, status=FileStatus.FAILED)
    assert [f["filename"] for f in only_failed["files"]] == ["a.mp4"]
    assert lib_env.client.get(f"{API}/999/browse").status_code == 404


def test_browse_treats_underscore_and_percent_in_folder_names_literally(lib_env):
    """The prefix match is SQL LIKE, where `_` and `%` are wildcards: browsing `Show_1` also
    listed the files of a sibling folder `Show 1`."""
    root = lib_env.root / "m"
    lib_id = _library(lib_env, root)
    _file(lib_env, lib_id, _write(root / "Show_1" / "ep.mp4"))
    _file(lib_env, lib_id, _write(root / "Show 1" / "other.mp4"))
    _file(lib_env, lib_id, _write(root / "100%" / "x.mp4"))
    _file(lib_env, lib_id, _write(root / "100 percent" / "y.mp4"))

    assert [f["filename"] for f in _browse(lib_env, lib_id, path="Show_1")["files"]] == ["ep.mp4"]
    assert [f["filename"] for f in _browse(lib_env, lib_id, path="100%")["files"]] == ["x.mp4"]


# --- job triggers -----------------------------------------------------------


def test_scan_queues_a_scan_and_refuses_a_second_one(lib_env):
    root = lib_env.root / "m"
    root.mkdir()
    lib_id = _library(lib_env, root)

    assert lib_env.client.post(f"{API}/{lib_id}/scan").status_code == 202
    assert lib_env.enqueued == [(None, "scan_library", (lib_id,))]

    s = lib_env.Session()
    s.add(Job(type=JobType.SCAN, status=JobStatus.RUNNING, library_id=lib_id))
    s.commit()
    s.close()
    assert lib_env.client.post(f"{API}/{lib_id}/scan").status_code == 409
    assert lib_env.client.post(f"{API}/999/scan").status_code == 404


@pytest.mark.parametrize(
    "route,job_type,fn",
    [
        ("phash-scan", JobType.PHASH_SCAN, "scan_phash_library"),
        ("find-duplicates", JobType.DUPLICATES, "find_duplicates"),
    ],
)
def test_extraction_jobs_need_indexed_files_and_run_one_at_a_time(lib_env, route, job_type, fn):
    root = lib_env.root / "m"
    lib_id = _library(lib_env, root)
    url = f"{API}/{lib_id}/{route}"

    assert lib_env.client.post(url).status_code == 422  # nothing indexed yet
    _file(lib_env, lib_id, _write(root / "a.mp4"))

    r = lib_env.client.post(url)
    assert r.status_code == 202 and r.json()["job_id"]
    assert lib_env.enqueued[-1][1] == fn

    s = lib_env.Session()
    s.add(Job(type=job_type, status=JobStatus.PENDING, library_id=lib_id))
    s.commit()
    s.close()
    assert lib_env.client.post(url).status_code == 409
    assert lib_env.client.post(f"{API}/999/{route}").status_code == 404


# --- stats ------------------------------------------------------------------


def test_scanner_module_thumbnail_dir_is_isolated(lib_env):
    """Guard for this file's own fixture: a test must never touch the real thumbnail cache."""
    assert scanner.thumbnail_path(1) == str(lib_env.thumbs / "1.jpg")
