"""The watcher's reconcile (`_apply_video_changes` / `_apply_audio_changes`): the code that keeps
the DB in step with the disk. Real files in a temp dir, a real (private) SQLite DB; only the
ffprobe subprocess is faked, so the scanners' own field mapping runs."""

import os
import shutil
import threading
import time

import pytest

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.file import File, FileStatus
from app.models.library import Library
from app.services import audio_scanner, common, fs_watcher, scanner
from tests.media_fakes import audio_probe, video_probe

# --- fixtures ---------------------------------------------------------------


def _touch(path, data=b"x" * 10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return str(path)


def _video_library(factory, root):
    db = factory()
    lib = Library(name="v", path=str(root))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()
    return lib_id


def _audio_library(factory, root):
    db = factory()
    lib = AudioLibrary(name="a", path=str(root))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()
    return lib_id


def _files(factory, lib_id):
    db = factory()
    try:
        return {f.path: f for f in db.query(File).filter(File.library_id == lib_id).all()}
    finally:
        db.close()


def _audio_files(factory, lib_id):
    db = factory()
    try:
        return {f.path: f for f in db.query(AudioFile).filter(AudioFile.library_id == lib_id).all()}
    finally:
        db.close()


def _apply_video(lib_id, changed=()):
    fs_watcher._apply_video_changes(lib_id, frozenset(changed))


def _apply_audio(lib_id, changed=()):
    fs_watcher._apply_audio_changes(lib_id, frozenset(changed))


# --- video: additions -------------------------------------------------------


def test_new_file_from_an_event_is_inserted_with_probed_metadata(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4")
    probes[p] = video_probe(duration=12.5, size=777, codec="hevc", width=1920, height=1080)
    lib_id = _video_library(fs_db, root)

    _apply_video(lib_id, {p})

    f = _files(fs_db, lib_id)[p]
    assert (f.filename, f.extension, f.status) == ("a.mp4", "mp4", FileStatus.UNKNOWN)
    assert (f.duration, f.size, f.codec_name) == (12.5, 777, "hevc")
    assert (f.file_width, f.file_height, f.file_fps) == (1920, 1080, 30.0)
    assert f.scanned_at is not None and f.file_mtime is not None and f.file_date is not None
    db = fs_db()
    assert db.get(Library, lib_id).last_scanned_at is not None
    db.close()


def test_files_that_were_never_announced_are_found_by_the_disk_walk(fs_db, probes, tmp_path):
    """Added while the app was down, or dropped from the event stream: no event path at all."""
    root = tmp_path / "lib"
    for rel in ("a.mp4", "sub/deep/b.mkv"):
        p = _touch(root / rel)
        probes[p] = video_probe()
    lib_id = _video_library(fs_db, root)

    _apply_video(lib_id)

    assert {os.path.relpath(p, root) for p in _files(fs_db, lib_id)} == {"a.mp4", "sub/deep/b.mkv"}


def test_walk_ignores_temp_files_originals_and_non_video(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    keep = _touch(root / "keep.mp4")
    probes[keep] = video_probe()
    for rel in (
        ".hidden.mp4",
        "x.compressing-1-2.mp4",
        "y.transcoding.mp4",
        "_originals/old.mp4",
        "notes.txt",
    ):
        _touch(root / rel)
    lib_id = _video_library(fs_db, root)

    _apply_video(lib_id)

    assert list(_files(fs_db, lib_id)) == [keep]


def test_a_failed_probe_still_registers_the_file(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "broken.mp4", b"not a video")  # no entry in `probes` -> probe fails
    lib_id = _video_library(fs_db, root)

    _apply_video(lib_id, {p})

    f = _files(fs_db, lib_id)[p]
    assert f.size == 11 and f.duration is None and f.codec_name is None
    assert f.scanned_at is not None


def test_an_event_for_a_file_that_is_already_gone_is_skipped(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    root.mkdir()
    lib_id = _video_library(fs_db, root)

    _apply_video(lib_id, {str(root / "ghost.mp4")})

    assert _files(fs_db, lib_id) == {}


# --- video: updates ---------------------------------------------------------


def _ingest(fs_db, probes, root, name="a.mp4", **probe):
    p = _touch(root / name)
    probes[p] = video_probe(**probe)
    lib_id = _video_library(fs_db, root)
    _apply_video(lib_id, {p})
    return lib_id, p


def test_a_spurious_event_writes_nothing(fs_db, probes, tmp_path):
    """Another process touching the file with no real change must not bump `updated_at` (it
    would tell every page watching the library's SSE stream that something changed)."""
    lib_id, p = _ingest(fs_db, probes, tmp_path / "lib")
    before = _files(fs_db, lib_id)[p]

    _apply_video(lib_id, {p})

    after = _files(fs_db, lib_id)[p]
    assert after.scanned_at == before.scanned_at
    assert after.updated_at == before.updated_at


def test_changed_content_updates_the_row_and_drops_the_stale_thumbnail(fs_db, probes, tmp_path):
    lib_id, p = _ingest(fs_db, probes, tmp_path / "lib", duration=10.0, size=100)
    row = _files(fs_db, lib_id)[p]
    thumb = scanner.thumbnail_path(row.id)
    _touch(thumb)
    open(scanner._thumbnail_failed_marker_path(row.id), "w").close()
    probes[p] = video_probe(duration=99.0, size=4242, codec="av1")

    _apply_video(lib_id, {p})

    f = _files(fs_db, lib_id)[p]
    assert (f.duration, f.size, f.codec_name) == (99.0, 4242, "av1")
    assert f.scanned_at > row.scanned_at
    assert not os.path.exists(thumb)  # regenerated lazily from the new bytes
    assert not os.path.exists(scanner._thumbnail_failed_marker_path(row.id))


def test_a_probe_failure_on_a_known_file_keeps_its_old_metadata(fs_db, probes, tmp_path):
    lib_id, p = _ingest(fs_db, probes, tmp_path / "lib", duration=10.0, codec="h264")
    del probes[p]  # ffprobe now fails (a transient hiccup, a locked file...)
    with open(p, "ab") as fh:
        fh.write(b"more")  # the size really did change

    _apply_video(lib_id, {p})

    f = _files(fs_db, lib_id)[p]
    assert (f.duration, f.codec_name) == (10.0, "h264")  # not nulled out
    assert f.size == 14  # but the stat'd size is kept up to date


# --- video: deletions -------------------------------------------------------


def test_missing_files_are_pruned_with_their_thumbnail_and_failed_marker(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    keep = _touch(root / "keep.mp4")
    gone = _touch(root / "gone.mp4")
    probes[keep] = probes[gone] = video_probe()
    lib_id = _video_library(fs_db, root)
    _apply_video(lib_id)
    rows = _files(fs_db, lib_id)
    _touch(scanner.thumbnail_path(rows[gone].id))
    open(scanner._thumbnail_failed_marker_path(rows[gone].id), "w").close()

    os.remove(gone)
    _apply_video(lib_id)  # no event at all: the sweep alone must notice

    assert list(_files(fs_db, lib_id)) == [keep]
    assert not os.path.exists(scanner.thumbnail_path(rows[gone].id))
    assert not os.path.exists(scanner._thumbnail_failed_marker_path(rows[gone].id))


def test_rm_rf_of_a_subfolder_prunes_every_row_in_it(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    paths = [_touch(root / "keep.mp4")] + [_touch(root / "sub" / f"{i}.mp4") for i in range(3)]
    for p in paths:
        probes[p] = video_probe()
    lib_id = _video_library(fs_db, root)
    _apply_video(lib_id)
    assert len(_files(fs_db, lib_id)) == 4

    shutil.rmtree(root / "sub")
    _apply_video(lib_id)

    assert list(_files(fs_db, lib_id)) == [paths[0]]


# --- video: robustness ------------------------------------------------------


def test_unknown_library_is_a_noop(fs_db, probes):
    _apply_video(12345, {"/nowhere/a.mp4"})  # must not raise


def test_a_library_whose_folder_vanished_keeps_its_rows(fs_db, probes, tmp_path):
    """An unmounted drive / removed bind mount looks like 'every file was deleted'. Pruning on
    that would wipe the library's rows (and every hash / pHash / shared-audio value extracted
    for it); `reconcile_all` already refuses to touch a library whose folder is gone, a live
    fire must agree."""
    root = tmp_path / "lib"
    paths = [_touch(root / f"{i}.mp4") for i in range(3)]
    for p in paths:
        probes[p] = video_probe()
    lib_id = _video_library(fs_db, root)
    _apply_video(lib_id)

    shutil.rmtree(root)
    fs_watcher._apply("video", lib_id, frozenset(paths))  # what a fire does after delete events

    assert set(_files(fs_db, lib_id)) == set(paths)


def test_one_file_that_fails_to_probe_does_not_abort_the_rest_of_the_batch(
    fs_db, probes, monkeypatch, tmp_path
):
    """A file can vanish between the walk and its probe (`os.path.getmtime` then raises). That
    must cost that file only, not every other path in the same debounced batch."""
    root = tmp_path / "lib"
    paths = [_touch(root / f"{i}.mp4") for i in range(4)]
    for p in paths:
        probes[p] = video_probe(duration=42.0)
    lib_id = _video_library(fs_db, root)
    real = scanner.probe_metadata
    calls = []

    def flaky(path):
        calls.append(path)
        if len(calls) == 1:  # whichever path happens to be probed first
            raise FileNotFoundError(path)
        return real(path)

    monkeypatch.setattr(scanner, "probe_metadata", flaky)

    _apply_video(lib_id, set(paths))

    rows = _files(fs_db, lib_id)
    assert sorted(f.duration for f in rows.values() if f.duration) == [42.0] * 3


def test_a_row_that_was_registered_but_never_probed_is_probed_by_the_next_sweep(
    fs_db, probes, monkeypatch, tmp_path
):
    """The probe raised once (or the app stopped between the insert and the probe): the row
    exists with no metadata, and no event will ever announce that file again."""
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4")
    probes[p] = video_probe(duration=33.0)
    lib_id = _video_library(fs_db, root)
    real = scanner.probe_metadata
    boom = [True]

    def fail_once(path):
        if boom[0]:
            boom[0] = False
            raise OSError("stale file handle")
        return real(path)

    monkeypatch.setattr(scanner, "probe_metadata", fail_once)
    _apply_video(lib_id, {p})
    assert _files(fs_db, lib_id)[p].scanned_at is None  # registered, not probed

    _apply_video(lib_id)  # a later sweep with no event for it

    f = _files(fs_db, lib_id)[p]
    assert f.duration == 33.0 and f.scanned_at is not None


def test_a_file_that_is_unreadable_to_ffprobe_is_not_retried_forever(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "corrupt.mp4")  # no probe entry: ffprobe fails
    lib_id = _video_library(fs_db, root)
    _apply_video(lib_id, {p})
    first = _files(fs_db, lib_id)[p].scanned_at

    _apply_video(lib_id)

    assert _files(fs_db, lib_id)[p].scanned_at == first  # not re-probed, no rewrite


# --- audio ------------------------------------------------------------------


def test_audio_new_files_are_found_and_probed(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    p = _touch(root / "album" / "song.mp3")
    audio_probes[p] = audio_probe(duration=200.0, codec="mp3", sample_rate=48000, channels=1)
    lib_id = _audio_library(fs_db, root)

    _apply_audio(lib_id)  # never announced: found by the walk

    f = _audio_files(fs_db, lib_id)[p]
    assert (f.filename, f.extension, f.status) == ("song.mp3", ".mp3", FileStatus.DONE)
    assert (f.duration, f.codec_name, f.sample_rate, f.channels) == (200.0, "mp3", 48000, 1)
    assert f.scan_error is None


def test_audio_new_file_with_a_failed_probe_is_registered_as_unknown(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    p = _touch(root / "bad.mp3")
    lib_id = _audio_library(fs_db, root)

    _apply_audio(lib_id, {p})

    f = _audio_files(fs_db, lib_id)[p]
    assert f.status == FileStatus.UNKNOWN and f.scan_error == "ffprobe failed"


def test_audio_missing_files_are_pruned(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    keep = _touch(root / "keep.mp3")
    gone = _touch(root / "gone.mp3")
    audio_probes[keep] = audio_probes[gone] = audio_probe()
    lib_id = _audio_library(fs_db, root)
    _apply_audio(lib_id)

    os.remove(gone)
    _apply_audio(lib_id)

    assert list(_audio_files(fs_db, lib_id)) == [keep]


def test_audio_spurious_event_writes_nothing(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    p = _touch(root / "a.mp3")
    audio_probes[p] = audio_probe()
    lib_id = _audio_library(fs_db, root)
    _apply_audio(lib_id, {p})
    before = _audio_files(fs_db, lib_id)[p]

    _apply_audio(lib_id, {p})

    after = _audio_files(fs_db, lib_id)[p]
    assert (after.scanned_at, after.updated_at) == (before.scanned_at, before.updated_at)


def test_audio_changed_content_is_updated(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    p = _touch(root / "a.mp3")
    audio_probes[p] = audio_probe(duration=100.0, bit_rate=128_000)
    lib_id = _audio_library(fs_db, root)
    _apply_audio(lib_id, {p})

    audio_probes[p] = audio_probe(duration=100.0, bit_rate=64_000, codec="opus")
    _apply_audio(lib_id, {p})

    f = _audio_files(fs_db, lib_id)[p]
    assert (f.bitrate, f.codec_name) == (64_000, "opus")


def test_audio_library_whose_folder_vanished_keeps_its_rows(fs_db, audio_probes, tmp_path):
    root = tmp_path / "music"
    p = _touch(root / "a.mp3")
    audio_probes[p] = audio_probe()
    lib_id = _audio_library(fs_db, root)
    _apply_audio(lib_id)

    shutil.rmtree(root)
    fs_watcher._apply("audio", lib_id, frozenset({p}))

    assert list(_audio_files(fs_db, lib_id)) == [p]


def test_audio_one_bad_file_does_not_abort_the_batch(fs_db, audio_probes, monkeypatch, tmp_path):
    root = tmp_path / "music"
    paths = [_touch(root / f"{i}.mp3") for i in range(4)]
    for p in paths:
        audio_probes[p] = audio_probe(duration=77.0)
    lib_id = _audio_library(fs_db, root)
    real = audio_scanner.probe_audio_metadata
    calls = []

    def flaky(path):
        calls.append(path)
        if len(calls) == 1:
            raise OSError("stale file handle")
        return real(path)

    monkeypatch.setattr(audio_scanner, "probe_audio_metadata", flaky)

    _apply_audio(lib_id, set(paths))

    rows = _audio_files(fs_db, lib_id)
    assert sorted(f.duration for f in rows.values() if f.duration) == [77.0] * 3


# --- apply / fire / reconcile plumbing --------------------------------------


def test_apply_yields_to_a_running_scan_and_reports_it(fs_db, probes, tmp_path):
    root = tmp_path / "lib"
    p = _touch(root / "a.mp4")
    probes[p] = video_probe()
    lib_id = _video_library(fs_db, root)

    with common.library_scan_active("video", lib_id):
        assert fs_watcher._apply("video", lib_id, frozenset({p})) is False
    assert _files(fs_db, lib_id) == {}
    assert fs_watcher._apply("video", lib_id, frozenset({p})) is True
    assert list(_files(fs_db, lib_id)) == [p]


def test_apply_with_an_unknown_kind_does_nothing(caplog):
    assert fs_watcher._apply("bogus", 1, frozenset()) is True
    assert "unknown watch kind" in caplog.text


def test_a_pure_delete_batch_still_runs_the_sweep(monkeypatch):
    monkeypatch.setattr(fs_watcher, "_pending", {})
    key = ("video", 5)
    fs_watcher._pending[key] = fs_watcher._Pending(deleted={"/m/gone.mp4"})
    seen = []

    def fake_apply(kind, library_id, changed):
        seen.append(changed)
        return True

    monkeypatch.setattr(fs_watcher, "_apply", fake_apply)

    fs_watcher._fire(key)

    assert seen == [frozenset()]
    assert key not in fs_watcher._pending


def test_an_empty_or_unknown_batch_does_nothing(monkeypatch):
    monkeypatch.setattr(fs_watcher, "_pending", {("video", 1): fs_watcher._Pending()})
    monkeypatch.setattr(fs_watcher, "_apply", lambda *a: pytest.fail("must not apply"))

    fs_watcher._fire(("video", 1))  # nothing recorded
    fs_watcher._fire(("video", 2))  # no such key


def test_reconcile_all_covers_every_kind_and_skips_libraries_with_no_folder(
    fs_db, probes, audio_probes, tmp_path
):
    vroot, aroot = tmp_path / "v", tmp_path / "a"
    vp = _touch(vroot / "a.mp4")
    ap = _touch(aroot / "a.mp3")
    probes[vp] = video_probe()
    audio_probes[ap] = audio_probe()
    vid = _video_library(fs_db, vroot)
    aid = _audio_library(fs_db, aroot)
    dead = _video_library(fs_db, tmp_path / "not-mounted")  # folder does not exist
    db = fs_db()
    db.add(File(library_id=dead, path=str(tmp_path / "not-mounted" / "x.mp4"), filename="x.mp4"))
    db.commit()
    db.close()

    fs_watcher.reconcile_all()

    assert list(_files(fs_db, vid)) == [vp]
    assert list(_audio_files(fs_db, aid)) == [ap]
    assert len(_files(fs_db, dead)) == 1  # untouched


class _Obs:
    def __init__(self):
        self.stopped = False
        self.scheduled = []

    def schedule(self, handler, path, recursive):
        self.scheduled.append(path)
        return path

    def unschedule(self, handle):
        pass

    def stop(self):
        self.stopped = True


def test_watch_all_libraries_watches_existing_folders_of_every_kind(fs_db, monkeypatch, tmp_path):
    obs = _Obs()
    monkeypatch.setattr(fs_watcher, "_observer", obs)
    monkeypatch.setattr(fs_watcher, "_handles", {})
    monkeypatch.setattr(fs_watcher, "_reconcile_loop", lambda: None)
    (tmp_path / "v").mkdir()
    (tmp_path / "a").mkdir()
    _video_library(fs_db, tmp_path / "v")
    _video_library(fs_db, tmp_path / "missing")
    _audio_library(fs_db, tmp_path / "a")

    fs_watcher.watch_all_libraries()

    assert sorted(obs.scheduled) == sorted([str(tmp_path / "v"), str(tmp_path / "a")])
    assert set(fs_watcher._handles) == {("video", 1), ("audio", 1)}


def test_shutdown_cancels_pending_timers_and_stops_the_observer(monkeypatch):
    obs = _Obs()
    monkeypatch.setattr(fs_watcher, "_observer", obs)
    timer = threading.Timer(60, lambda: None)
    timer.start()
    monkeypatch.setattr(
        fs_watcher, "_pending", {("video", 1): fs_watcher._Pending(timer=timer, changed={"x"})}
    )
    try:
        fs_watcher.shutdown()
        assert obs.stopped and fs_watcher._observer is None
        assert fs_watcher._pending == {}
        timer.join(1)
        assert not timer.is_alive()
    finally:
        fs_watcher._reconcile_stop.clear()
        timer.cancel()


# --- the whole live path ----------------------------------------------------


def _wait_for(predicate, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_a_dispatched_event_ends_up_as_a_row_after_the_debounce(
    fs_db, probes, monkeypatch, tmp_path
):
    monkeypatch.setattr(fs_watcher, "_DEBOUNCE", 0.05)
    monkeypatch.setattr(fs_watcher, "_pending", {})
    root = tmp_path / "lib"
    p = _touch(root / "new.mp4")
    probes[p] = video_probe(duration=5.0)
    temp = _touch(root / "new.compressing-1-1.mp4")
    lib_id = _video_library(fs_db, root)
    handler = fs_watcher._Handler(lib_id, kind="video")

    class Created:
        is_directory = False

        def __init__(self, path):
            self.src_path = path

    Created.__name__ = "FileCreatedEvent"
    handler.dispatch(Created(temp))  # ignored: an in-progress encode
    handler.dispatch(Created(p))

    assert _wait_for(lambda: p in _files(fs_db, lib_id))
    assert temp not in _files(fs_db, lib_id)


# --- the extension lists must not drift apart -------------------------------


def test_watcher_extension_lists_match_what_the_scanners_index():
    """The watcher decides which events matter; if its list is narrower than the scanner's, a
    new file of the missing type waits for the 90 s sweep instead of the 3 s debounce, and if
    it is wider the watcher indexes files a scan never would."""
    from app.services.image_scanner import SUPPORTED_EXTENSIONS

    assert fs_watcher._VIDEO_EXTS == scanner.VIDEO_EXTENSIONS
    assert fs_watcher._IMAGE_EXTS == SUPPORTED_EXTENSIONS
    assert audio_scanner.AUDIO_EXTENSIONS == fs_watcher._Handler(1, "audio").valid_exts


# --- images -----------------------------------------------------------------


@pytest.fixture
def image_env(fs_db, monkeypatch, tmp_path):
    """Image watcher plumbing: no thumbnail rendering, otherwise the real Pillow metadata."""
    from app.services import image_scanner

    monkeypatch.setattr(image_scanner, "generate_thumbnail", lambda *a, **k: None)
    monkeypatch.setattr(image_scanner, "THUMBNAIL_DIR", str(tmp_path / "img-thumbs"))
    return fs_db


def _image_library(factory, root):
    from app.models.image_library import ImageLibrary

    db = factory()
    lib = ImageLibrary(name="i", path=str(root))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()
    return lib_id


def _png(path):
    from PIL import Image

    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", (32, 24), (10, 20, 30)).save(path)
    return str(path)


def _images(factory, lib_id):
    from app.models.image import ImageFile

    db = factory()
    try:
        return {f.path: f for f in db.query(ImageFile).filter(ImageFile.library_id == lib_id)}
    finally:
        db.close()


def test_image_new_and_missing_files_are_reconciled(image_env, tmp_path):
    root = tmp_path / "pics"
    keep = _png(root / "keep.png")
    gone = _png(root / "gone.png")
    lib_id = _image_library(image_env, root)
    fs_watcher._apply_image_changes(lib_id, frozenset())
    rows = _images(image_env, lib_id)
    assert set(rows) == {keep, gone}
    assert (rows[keep].width, rows[keep].height) == (32, 24)

    os.remove(gone)
    fs_watcher._apply_image_changes(lib_id, frozenset())

    assert list(_images(image_env, lib_id)) == [keep]


def test_image_library_whose_folder_vanished_keeps_its_rows(image_env, tmp_path):
    root = tmp_path / "pics"
    p = _png(root / "a.png")
    lib_id = _image_library(image_env, root)
    fs_watcher._apply_image_changes(lib_id, frozenset())

    shutil.rmtree(root)
    fs_watcher._apply("image", lib_id, frozenset({p}))

    assert list(_images(image_env, lib_id)) == [p]


def test_image_one_bad_file_does_not_abort_the_batch(image_env, monkeypatch, tmp_path):
    from app.services import image_analyzer

    root = tmp_path / "pics"
    paths = [_png(root / f"{i}.png") for i in range(4)]
    lib_id = _image_library(image_env, root)
    real = image_analyzer.get_image_metadata
    calls = []

    def flaky(path):
        calls.append(path)
        if len(calls) == 1:
            raise OSError("stale file handle")
        return real(path)

    monkeypatch.setattr(image_analyzer, "get_image_metadata", flaky)

    fs_watcher._apply_image_changes(lib_id, frozenset(paths))

    assert len(_images(image_env, lib_id)) == 3
