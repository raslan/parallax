"""The video scanner (the oldest code in the app): ffprobe field mapping, the disk walk, the scan
job, rescans and the thumbnail plumbing. Real files in a temp dir and a real (private) SQLite DB;
only the ffprobe / ffmpeg subprocesses are faked."""

import json
import os
import subprocess
from types import SimpleNamespace

import pytest

from app.models.file import File, FileStatus
from app.models.job import Job, JobLog, JobStatus, JobType
from app.models.library import Library
from app.services import common, scanner
from tests.media_fakes import video_probe

# --- helpers ----------------------------------------------------------------


def _touch(path, data=b"x" * 10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return str(path)


def _library(factory, root):
    db = factory()
    lib = Library(name="v", path=str(root))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()
    return lib_id


def _rows(factory, lib_id):
    db = factory()
    try:
        return {f.path: f for f in db.query(File).filter(File.library_id == lib_id)}
    finally:
        db.close()


def _scan_job(factory):
    db = factory()
    try:
        return db.query(Job).filter(Job.type == JobType.SCAN).order_by(Job.id.desc()).first()
    finally:
        db.close()


def _job_logs(factory, job_id):
    db = factory()
    try:
        return [
            (row.level, row.message) for row in db.query(JobLog).filter(JobLog.job_id == job_id)
        ]
    finally:
        db.close()


@pytest.fixture
def warm_calls(monkeypatch):
    import app.queue

    calls = []
    monkeypatch.setattr(app.queue, "enqueue_threadsafe", lambda *a: calls.append(a))
    return calls


# --- probe_file -------------------------------------------------------------


def _fake_run(monkeypatch, *, returncode=0, stdout="", raises=None):
    def run(*a, **k):
        if raises:
            raise raises
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr="")

    monkeypatch.setattr(scanner.subprocess, "run", run)


def test_probe_file_parses_ffprobes_json(monkeypatch):
    _fake_run(monkeypatch, stdout=json.dumps(video_probe(duration=3.0)))

    assert scanner.probe_file("/x.mp4")["format"]["duration"] == "3.0"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"returncode": 1, "stdout": "{}"},
        {"stdout": "not json at all"},
        {"raises": subprocess.TimeoutExpired("ffprobe", 30)},
        {"raises": FileNotFoundError("ffprobe")},
    ],
)
def test_probe_file_returns_empty_on_any_failure(monkeypatch, kwargs):
    _fake_run(monkeypatch, **kwargs)

    assert scanner.probe_file("/x.mp4") == {}


# --- probe_metadata ---------------------------------------------------------


def test_probe_metadata_maps_every_column(probes, tmp_path):
    p = _touch(tmp_path / "a.mp4")
    probes[p] = video_probe(
        duration=61.5, size=1234, codec="hevc", width=3840, height=2160, fps="24000/1001"
    )

    meta = scanner.probe_metadata(p)

    assert meta["probe_ok"] is True
    assert (meta["duration"], meta["size"], meta["codec_name"]) == (61.5, 1234, "hevc")
    assert (meta["file_width"], meta["file_height"]) == (3840, 2160)
    assert meta["file_fps"] == 23.976
    assert meta["video_bitrate"] == 800_000
    assert meta["file_mtime"] == os.path.getmtime(p)


@pytest.mark.parametrize(
    "fps,expected",
    [("30/1", 30.0), ("30000/1001", 29.97), ("25", 25.0), ("0/0", None), ("", None), ("N/A", None)],
)
def test_probe_metadata_frame_rates(probes, tmp_path, fps, expected):
    p = _touch(tmp_path / "a.mp4")
    probes[p] = video_probe(fps=fps)

    assert scanner.probe_metadata(p)["file_fps"] == expected


def test_probe_metadata_bitrate_falls_back_to_the_container_and_ignores_junk(probes, tmp_path):
    p = _touch(tmp_path / "a.mp4")
    data = video_probe(bit_rate=None)
    data["format"]["bit_rate"] = "5000"
    probes[p] = data
    assert scanner.probe_metadata(p)["video_bitrate"] == 5000

    data["format"]["bit_rate"] = "garbage"
    assert scanner.probe_metadata(p)["video_bitrate"] is None


def test_probe_metadata_with_no_video_stream(probes, tmp_path):
    p = _touch(tmp_path / "a.mp4")
    probes[p] = {"streams": [], "format": {"duration": "9.0", "size": "99"}}

    meta = scanner.probe_metadata(p)

    assert meta["probe_ok"] and meta["duration"] == 9.0
    assert meta["codec_name"] is None and meta["file_width"] is None


def test_a_failed_probe_still_reports_size_and_dates(probes, tmp_path):
    p = _touch(tmp_path / "broken.mp4", b"12345")

    meta = scanner.probe_metadata(p)

    assert meta["probe_ok"] is False and meta["size"] == 5 and meta["duration"] is None
    assert meta["file_date"] == meta["file_mtime"] == os.path.getmtime(p)


def test_a_file_that_vanished_before_its_probe_raises_oserror(probes, tmp_path):
    """Deliberate: Organize reads this as 'no details for that file', and the scan and the
    watcher isolate it per file (see their own tests)."""
    with pytest.raises(OSError):
        scanner.probe_metadata(str(tmp_path / "gone.mp4"))


def test_content_date_comes_from_creation_time_when_it_is_real(probes, tmp_path):
    p = _touch(tmp_path / "a.mp4")
    probes[p] = video_probe(creation_time="2021-06-15T12:00:00.000000Z")

    meta = scanner.probe_metadata(p)

    assert meta["file_date"] == 1623758400.0
    assert meta["file_mtime"] != meta["file_date"]


@pytest.mark.parametrize("tag", [None, "not a date", "2019"])
def test_a_missing_or_unparsable_creation_time_falls_back_to_the_modified_time(
    probes, tmp_path, tag
):
    p = _touch(tmp_path / "a.mp4")
    probes[p] = video_probe(creation_time=tag)

    meta = scanner.probe_metadata(p)

    assert meta["file_date"] == meta["file_mtime"]


# --- _find_video_files ------------------------------------------------------


def test_the_walk_finds_videos_recursively_in_any_case_and_sorted(tmp_path):
    root = tmp_path / "lib"
    for rel in ("b.mp4", "a.MKV", "sub/deep/c.webm", "d.rmvb", "sub/e.AVI"):
        _touch(root / rel)

    found = scanner._find_video_files(str(root))

    assert [os.path.relpath(p, root) for p in found] == sorted(
        ["b.mp4", "a.MKV", "sub/deep/c.webm", "d.rmvb", "sub/e.AVI"]
    )


def test_the_walk_skips_temp_files_originals_hidden_files_and_other_types(tmp_path):
    root = tmp_path / "lib"
    keep = _touch(root / "keep.mp4")
    for rel in (
        ".hidden.mp4",
        "x.compressing-1-2.mp4",
        "y.transcoding.mkv",
        "_originals/old.mp4",
        "sub/_originals/older.mp4",
        "movie.srt",
        "cover.jpg",
        "noextension",
    ):
        _touch(root / rel)

    assert scanner._find_video_files(str(root)) == [keep]


def test_the_walk_of_a_missing_folder_is_empty(tmp_path):
    assert scanner._find_video_files(str(tmp_path / "nope")) == []


# --- scan_library -----------------------------------------------------------


def test_a_scan_indexes_probes_and_completes(fs_db, probes, warm_calls, tmp_path):
    root = tmp_path / "lib"
    a = _touch(root / "a.mp4")
    b = _touch(root / "sub" / "b.mkv")
    probes[a] = video_probe(duration=10.0, size=111)
    probes[b] = video_probe(duration=20.0, size=222, codec="hevc")
    lib_id = _library(fs_db, root)

    scanner.scan_library(lib_id)

    rows = _rows(fs_db, lib_id)
    assert set(rows) == {a, b}
    assert (rows[a].duration, rows[a].size, rows[b].codec_name) == (10.0, 111, "hevc")
    assert (rows[a].filename, rows[a].extension) == ("a.mp4", "mp4")
    assert rows[a].scanned_at is not None and rows[a].file_mtime is not None
    job = _scan_job(fs_db)
    assert (job.status, job.progress, job.total_files, job.processed_files) == (
        JobStatus.COMPLETED,
        100.0,
        2,
        2,
    )
    db = fs_db()
    assert db.get(Library, lib_id).last_scanned_at is not None
    db.close()
    assert [m for _, m in _job_logs(fs_db, job.id)][-1] == "Scan complete"
    assert warm_calls == [(None, scanner._warm_thumbnails, lib_id)]  # thumbnails follow, queued


def test_a_rescan_updates_rows_in_place_and_prunes_the_vanished(
    fs_db, probes, warm_calls, tmp_path
):
    root = tmp_path / "lib"
    keep = _touch(root / "keep.mp4")
    gone = _touch(root / "gone.mp4")
    probes[keep] = probes[gone] = video_probe(duration=10.0)
    lib_id = _library(fs_db, root)
    scanner.scan_library(lib_id)
    first = _rows(fs_db, lib_id)
    _touch(scanner.thumbnail_path(first[gone].id))
    open(scanner._thumbnail_failed_marker_path(first[gone].id), "w").close()

    os.remove(gone)
    probes[keep] = video_probe(duration=99.0)
    scanner.scan_library(lib_id)

    rows = _rows(fs_db, lib_id)
    assert list(rows) == [keep]
    assert rows[keep].id == first[keep].id  # same row, not re-created
    assert rows[keep].duration == 99.0
    assert not os.path.exists(scanner.thumbnail_path(first[gone].id))
    assert not os.path.exists(scanner._thumbnail_failed_marker_path(first[gone].id))


def test_a_scan_registers_itself_so_the_watcher_stands_down(
    fs_db, probes, warm_calls, monkeypatch, tmp_path
):
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4")
    probes[p] = video_probe()
    lib_id = _library(fs_db, root)
    seen = []
    real = scanner.probe_metadata

    def spying(path):
        seen.append(common.scan_active("video", lib_id))
        return real(path)

    monkeypatch.setattr(scanner, "probe_metadata", spying)

    scanner.scan_library(lib_id)

    assert seen == [True]
    assert not common.scan_active("video", lib_id)  # released when the scan ends


def test_one_file_that_fails_to_probe_is_logged_and_the_scan_goes_on(
    fs_db, probes, warm_calls, monkeypatch, tmp_path
):
    root = tmp_path / "lib"
    paths = [_touch(root / f"{i}.mp4") for i in range(3)]
    for p in paths:
        probes[p] = video_probe(duration=5.0)
    lib_id = _library(fs_db, root)
    real = scanner.probe_metadata

    def flaky(path):
        if path == paths[1]:
            raise OSError("stale file handle")
        return real(path)

    monkeypatch.setattr(scanner, "probe_metadata", flaky)

    scanner.scan_library(lib_id)

    job = _scan_job(fs_db)
    assert job.status == JobStatus.COMPLETED
    rows = _rows(fs_db, lib_id)
    assert rows[paths[0]].duration == 5.0 and rows[paths[2]].duration == 5.0
    assert rows[paths[1]].duration is None
    warnings = [m for lvl, m in _job_logs(fs_db, job.id) if lvl == "warning"]
    assert warnings and "1.mp4" in warnings[0] and "stale file handle" in warnings[0]


def test_a_scan_of_a_library_whose_folder_is_gone_fails_and_keeps_every_row(
    fs_db, probes, warm_calls, tmp_path
):
    """Scanning an unmounted drive must not look like 'every file was deleted'."""
    root = tmp_path / "lib"
    paths = [_touch(root / f"{i}.mp4") for i in range(3)]
    for p in paths:
        probes[p] = video_probe()
    lib_id = _library(fs_db, root)
    scanner.scan_library(lib_id)
    import shutil

    shutil.rmtree(root)

    scanner.scan_library(lib_id)

    job = _scan_job(fs_db)
    assert job.status == JobStatus.FAILED and "folder not found" in job.error.lower()
    assert set(_rows(fs_db, lib_id)) == set(paths)
    assert warm_calls == [(None, scanner._warm_thumbnails, lib_id)]  # only the first scan's


def test_a_scan_of_an_unknown_library_does_nothing(fs_db, warm_calls):
    scanner.scan_library(999)

    assert _scan_job(fs_db) is None and warm_calls == []


def test_cancelling_mid_scan_stops_it_and_keeps_what_was_indexed(
    fs_db, probes, warm_calls, monkeypatch, tmp_path
):
    root = tmp_path / "lib"
    for i in range(3):
        probes[_touch(root / f"{i}.mp4")] = video_probe()
    lib_id = _library(fs_db, root)
    real = scanner.probe_metadata

    def cancelling(path):
        job = _scan_job(fs_db)
        common.request_cancel(job.id)
        return real(path)

    monkeypatch.setattr(scanner, "probe_metadata", cancelling)

    scanner.scan_library(lib_id)

    job = _scan_job(fs_db)
    try:
        assert job.status == JobStatus.CANCELLED and job.finished_at is not None
        assert len(_rows(fs_db, lib_id)) == 3  # registered before the probes ran
        assert warm_calls == []  # no thumbnail follow-up for a cancelled scan
        assert "Scan cancelled" in [m for _, m in _job_logs(fs_db, job.id)]
    finally:
        common.clear_cancel(job.id)


# --- rescan_file ------------------------------------------------------------


def _row(factory, lib_id, path, **cols):
    db = factory()
    row = File(
        library_id=lib_id,
        path=path,
        filename=os.path.basename(path),
        status=FileStatus.DONE,
        **cols,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return db, row


def test_rescan_refreshes_metadata_but_not_the_added_dates(fs_db, probes, monkeypatch, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4")
    probes[p] = video_probe(duration=50.0, size=500, codec="hevc")
    lib_id = _library(fs_db, root)
    db, row = _row(fs_db, lib_id, p, duration=10.0, file_mtime=111.0, file_date=222.0)
    open(scanner._thumbnail_failed_marker_path(row.id), "w").close()
    thumbs = []
    monkeypatch.setattr(
        scanner,
        "generate_thumbnail",
        lambda path, fid, duration=None: thumbs.append((fid, duration)),
    )

    scanner.rescan_file(db, row)

    db.refresh(row)
    assert (row.duration, row.size, row.codec_name) == (50.0, 500, "hevc")
    assert (row.file_mtime, row.file_date) == (111.0, 222.0)  # "File added" must not jump
    assert row.scanned_at is not None and row.status == FileStatus.DONE
    assert not os.path.exists(scanner._thumbnail_failed_marker_path(row.id))
    assert thumbs == [(row.id, 50.0)]  # the probe's duration is reused for the seek point
    db.close()


def test_rescan_with_a_failed_probe_keeps_the_old_metadata(fs_db, probes, monkeypatch, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4", b"1234567")
    lib_id = _library(fs_db, root)
    db, row = _row(fs_db, lib_id, p, duration=10.0, codec_name="h264", size=1)
    monkeypatch.setattr(scanner, "generate_thumbnail", lambda *a, **k: True)

    scanner.rescan_file(db, row)

    db.refresh(row)
    assert (row.duration, row.codec_name) == (10.0, "h264")
    assert row.size == 7
    db.close()


# --- thumbnails -------------------------------------------------------------


def _fake_ffmpeg(monkeypatch, *, ok=True, calls=None):
    def run(cmd, **k):
        if calls is not None:
            calls.append(cmd)
        if ok:
            open(cmd[-1], "wb").write(b"jpeg")
        return SimpleNamespace(returncode=0 if ok else 1, stdout="", stderr="")

    monkeypatch.setattr(scanner.subprocess, "run", run)


def test_grab_frame_seeks_ten_percent_in_and_reports_success(monkeypatch, tmp_path):
    calls = []
    _fake_ffmpeg(monkeypatch, calls=calls)
    out = str(tmp_path / "t.jpg")

    assert scanner.grab_frame("/v.mp4", out, duration=200.0) is True

    cmd = calls[0]
    assert cmd[cmd.index("-ss") + 1] == "20.0"
    assert os.path.exists(out)


def test_grab_frame_probes_for_the_duration_when_not_given(probes, monkeypatch, tmp_path):
    calls = []
    _fake_ffmpeg(monkeypatch, calls=calls)
    probes["/v.mp4"] = video_probe(duration=100.0)

    scanner.grab_frame("/v.mp4", str(tmp_path / "t.jpg"))

    assert calls[0][calls[0].index("-ss") + 1] == "10.0"


def test_grab_frame_reports_failure(monkeypatch, tmp_path):
    _fake_ffmpeg(monkeypatch, ok=False)

    assert scanner.grab_frame("/v.mp4", str(tmp_path / "t.jpg"), duration=10.0) is False


def test_a_failed_regeneration_does_not_leave_the_previous_files_thumbnail_behind(
    fs_db, monkeypatch
):
    """Row ids get reused after a delete: a stale jpg would be served under a new file's id."""
    stale = scanner.thumbnail_path(42)
    _touch(stale, b"old file's frame")
    _fake_ffmpeg(monkeypatch, ok=False)

    assert scanner.generate_thumbnail("/new.mp4", 42, duration=10.0) is False

    assert not os.path.exists(stale)


# --- the post-scan thumbnail warm-up job ------------------------------------


def _warm_job(factory):
    db = factory()
    try:
        return db.query(Job).filter(Job.type == JobType.THUMBNAIL_WARM).first()
    finally:
        db.close()


def _seed_rows(factory, lib_id, root, n):
    db = factory()
    ids = []
    for i in range(n):
        row = File(
            library_id=lib_id,
            path=str(root / f"{i}.mp4"),
            filename=f"{i}.mp4",
            duration=10.0,
        )
        db.add(row)
        db.commit()
        ids.append(row.id)
    db.close()
    return ids


def test_warm_up_generates_only_the_missing_thumbnails_as_a_tracked_job(
    fs_db, monkeypatch, tmp_path
):
    root = tmp_path / "lib"
    lib_id = _library(fs_db, root)
    ids = _seed_rows(fs_db, lib_id, root, 4)
    _touch(scanner.thumbnail_path(ids[0]))  # already has one
    made = []

    def fake_get_or_create(file_id, path, duration=None):
        made.append(file_id)
        _touch(scanner.thumbnail_path(file_id))

    monkeypatch.setattr(scanner, "get_or_create_thumbnail", fake_get_or_create)

    scanner._warm_thumbnails(lib_id)

    assert sorted(made) == sorted(ids[1:])
    job = _warm_job(fs_db)
    assert (job.status, job.total_files, job.processed_files, job.progress) == (
        JobStatus.COMPLETED,
        3,
        3,
        100.0,
    )


def test_warm_up_makes_no_job_when_nothing_is_missing(fs_db, monkeypatch, tmp_path):
    root = tmp_path / "lib"
    lib_id = _library(fs_db, root)
    for fid in _seed_rows(fs_db, lib_id, root, 2):
        _touch(scanner.thumbnail_path(fid))
    monkeypatch.setattr(scanner, "get_or_create_thumbnail", lambda *a, **k: pytest.fail("no work"))

    scanner._warm_thumbnails(lib_id)

    assert _warm_job(fs_db) is None


def test_warm_up_survives_a_file_whose_thumbnail_cannot_be_made(fs_db, monkeypatch, tmp_path):
    root = tmp_path / "lib"
    lib_id = _library(fs_db, root)
    _seed_rows(fs_db, lib_id, root, 2)

    def boom(file_id, path, duration=None):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr(scanner, "get_or_create_thumbnail", boom)

    scanner._warm_thumbnails(lib_id)

    assert _warm_job(fs_db).status == JobStatus.COMPLETED


def test_clearing_a_failed_marker_is_idempotent(fs_db):
    scanner.clear_thumbnail_failed_marker(7)  # nothing there: must not raise
    open(scanner._thumbnail_failed_marker_path(7), "w").close()

    scanner.clear_thumbnail_failed_marker(7)

    assert not os.path.exists(scanner._thumbnail_failed_marker_path(7))
