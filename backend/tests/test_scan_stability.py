"""Scan/watcher stability: a scan must never wedge silently in RUNNING.

Root cause this covers: the filesystem watcher's whole-library reconcile
(every 90 s and on every fire) inserted rows for paths a long-running scan had
not reached yet; the scan's own INSERT then hit `UNIQUE(path)`, its `except`
handler committed on a poisoned session (raising again), and the queue
swallowed that — leaving the job RUNNING forever with a leaked producer thread.
"""

import os
import threading

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.image import ImageFile
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.models.settings import set_setting
from app.services import common, fs_watcher


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    """A private sqlite DB with every module's `SessionLocal` pointed at it."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'scan.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine)

    import app.database
    from app.services import audio_scanner, image_extract, image_scanner, scanner

    for mod in (app.database, image_scanner, image_extract, scanner, audio_scanner):
        monkeypatch.setattr(mod, "SessionLocal", factory)
    monkeypatch.setattr(image_scanner, "THUMBNAIL_DIR", str(tmp_path / "thumbs"))
    yield factory
    engine.dispose()


def _make_images(root, n):
    os.makedirs(root, exist_ok=True)
    paths = []
    for i in range(n):
        p = os.path.join(root, f"img{i}.png")
        Image.new("RGB", (64, 48), color=(i * 10 % 255, 20, 30)).save(p)
        paths.append(p)
    return paths


def _image_library(factory, root):
    db = factory()
    lib = ImageLibrary(name="t", path=str(root))
    db.add(lib)
    db.commit()
    job = Job(type=JobType.IMAGE_SCAN, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    ids = (lib.id, job.id)
    db.close()
    return ids


@pytest.fixture
def no_nudenet(monkeypatch):
    from app.services import image_analyzer

    calls = []

    def fake(arrays, model_id="320n"):
        calls.append(len(arrays))
        return [[] for _ in arrays]

    monkeypatch.setattr(image_analyzer, "run_nudenet_batch_arrays", fake)
    monkeypatch.setattr(image_analyzer, "release_sessions", lambda: None)
    return calls


@pytest.fixture
def warm_calls(monkeypatch):
    import app.queue

    calls = []
    monkeypatch.setattr(app.queue, "enqueue_threadsafe", lambda *a: calls.append(a))
    return calls


# --- scan registry ----------------------------------------------------------


def test_scan_active_marks_and_clears():
    assert not common.scan_active("image", 7)
    with common.library_scan_active("image", 7):
        assert common.scan_active("image", 7)
        assert not common.scan_active("video", 7)
    assert not common.scan_active("image", 7)


def test_scan_active_survives_overlapping_scans_of_one_library():
    with common.library_scan_active("audio", 3):
        with common.library_scan_active("audio", 3):
            pass
        assert common.scan_active("audio", 3)
    assert not common.scan_active("audio", 3)


# --- watcher yields to a running scan ---------------------------------------


def test_watcher_skips_library_while_scan_active(sessions, tmp_path):
    root = tmp_path / "imgs"
    _make_images(str(root), 2)
    lib_id, _ = _image_library(sessions, root)

    with common.library_scan_active("image", lib_id):
        fs_watcher._apply("image", lib_id, frozenset())
    db = sessions()
    assert db.query(ImageFile).count() == 0
    db.close()


def test_watcher_reconciles_when_no_scan(sessions, tmp_path, monkeypatch):
    from app.services import image_scanner

    monkeypatch.setattr(image_scanner, "generate_thumbnail", lambda *a, **k: None)
    root = tmp_path / "imgs"
    _make_images(str(root), 2)
    lib_id, _ = _image_library(sessions, root)

    fs_watcher._apply("image", lib_id, frozenset())
    db = sessions()
    assert db.query(ImageFile).count() == 2
    db.close()


def test_fire_requeues_when_scan_active(monkeypatch):
    monkeypatch.setattr(fs_watcher, "_pending", {})
    key = ("image", 9)
    fs_watcher._pending[key] = fs_watcher._Pending(changed={"/m/a.png"}, deleted={"/m/b.png"})
    applied = []
    monkeypatch.setattr(fs_watcher, "_apply_image_changes", lambda *a: applied.append(a))

    with common.library_scan_active("image", 9):
        fs_watcher._fire(key)

    assert applied == []
    p = fs_watcher._pending[key]
    try:
        assert p.changed == {"/m/a.png"} and p.deleted == {"/m/b.png"}
        assert p.timer is not None
    finally:
        p.timer.cancel()


# --- image scan survives rows inserted behind its back ------------------------


def test_image_scan_tolerates_rows_inserted_mid_scan(sessions, tmp_path, no_nudenet, warm_calls):
    from app.services.image_scanner import scan_image_library

    root = tmp_path / "imgs"
    paths = _make_images(str(root), 5)
    lib_id, job_id = _image_library(sessions, root)

    db = sessions()
    set_setting(db, "scan_batch_size", "1")
    db.close()

    # Simulate the watcher: after the first inference call, rows for every
    # remaining path appear (metadata only, no phash) — exactly what the
    # production reconcile did.
    from app.services import image_analyzer

    real = image_analyzer.run_nudenet_batch_arrays
    injected = []

    def inject_then_detect(arrays, model_id="320n"):
        if not injected:
            other = sessions()
            have = {r.path for r in other.query(ImageFile)}
            for p in (p for p in paths if p not in have):
                other.add(
                    ImageFile(
                        library_id=lib_id,
                        path=p,
                        filename=os.path.basename(p),
                        extension="png",
                        size=1,
                    )
                )
            other.commit()
            other.close()
            injected.append(True)
        return real(arrays, model_id)

    image_analyzer.run_nudenet_batch_arrays = inject_then_detect
    try:
        scan_image_library(lib_id, job_id, True, True, False)
    finally:
        image_analyzer.run_nudenet_batch_arrays = real

    db = sessions()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.COMPLETED, job.error
    rows = db.query(ImageFile).all()
    assert len(rows) == 5
    # The scan filled in the rows the "watcher" pre-created instead of colliding.
    assert all(r.phash is not None and r.content_scanned_at is not None for r in rows)
    db.close()


def test_image_scan_defers_thumbnails_to_followup_job(sessions, tmp_path, no_nudenet, warm_calls):
    from app.services.image_scanner import _warm_image_thumbnails, scan_image_library

    root = tmp_path / "imgs"
    _make_images(str(root), 3)
    lib_id, job_id = _image_library(sessions, root)

    scan_image_library(lib_id, job_id, True, True, False)

    assert not os.path.isdir(tmp_path / "thumbs") or not os.listdir(tmp_path / "thumbs")
    assert [(a[0], a[1], a[2]) for a in warm_calls] == [(None, _warm_image_thumbnails, lib_id)]

    _warm_image_thumbnails(lib_id)

    db = sessions()
    ids = [r.id for r in db.query(ImageFile).all()]
    warm = db.query(Job).filter(Job.type == JobType.THUMBNAIL_WARM).one()
    db.close()
    assert warm.status == JobStatus.COMPLETED and warm.total_files == 3
    assert all(os.path.exists(tmp_path / "thumbs" / f"{i}.jpg") for i in ids)


def test_image_scan_skips_pixel_decode_when_nothing_needs_it(
    sessions, tmp_path, no_nudenet, warm_calls, monkeypatch
):
    from app.services import image_scanner

    root = tmp_path / "imgs"
    _make_images(str(root), 2)
    lib_id, job_id = _image_library(sessions, root)
    decoded = []
    real = image_scanner._load_image_for_scan

    def spy(path, load_size, decode=True):
        decoded.append(decode)
        return real(path, load_size, decode)

    monkeypatch.setattr(image_scanner, "_load_image_for_scan", spy)
    image_scanner.scan_image_library(lib_id, job_id, False, False, False)

    assert decoded == [False, False]
    db = sessions()
    assert db.get(Job, job_id).status == JobStatus.COMPLETED
    rows = db.query(ImageFile).all()
    assert len(rows) == 2 and all(r.width == 64 and r.phash is None for r in rows)
    db.close()
    assert no_nudenet == []


# --- failure paths end FAILED, never stuck RUNNING ------------------------------


def _producer_threads():
    return [t for t in threading.enumerate() if t.name == "image-scan-producer" and t.is_alive()]


def test_image_scan_failure_marks_job_failed_and_stops_producer(
    sessions, tmp_path, no_nudenet, warm_calls, monkeypatch
):
    from app.services import image_scanner

    root = tmp_path / "imgs"
    _make_images(str(root), 8)
    lib_id, job_id = _image_library(sessions, root)
    db = sessions()
    set_setting(db, "scan_batch_size", "1")
    set_setting(db, "scan_prefetch", "1")
    db.close()

    calls = {"n": 0}
    real = image_scanner._phash_from_array

    def boom(arr):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("phash exploded")
        return real(arr)

    monkeypatch.setattr(image_scanner, "_phash_from_array", boom)
    image_scanner.scan_image_library(lib_id, job_id, True, False, False)

    db = sessions()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.FAILED and "phash exploded" in job.error
    db.close()
    for t in _producer_threads():
        t.join(timeout=5)
    assert _producer_threads() == []


def test_image_scan_poisoned_session_still_ends_failed(
    sessions, tmp_path, no_nudenet, warm_calls, monkeypatch
):
    """Duplicate path in one batch -> flush IntegrityError -> the handler's own
    commit used to raise PendingRollbackError and leave the job RUNNING."""
    from app.services import image_scanner

    root = tmp_path / "imgs"
    [p] = _make_images(str(root), 1)
    lib_id, job_id = _image_library(sessions, root)
    monkeypatch.setattr(image_scanner, "collect_image_paths", lambda _root: [p, p])
    image_scanner.scan_image_library(lib_id, job_id, True, False, False)
    db = sessions()
    assert db.get(Job, job_id).status == JobStatus.FAILED
    db.close()


def test_audio_scan_row_created_behind_its_back_still_ends_failed(sessions, tmp_path, monkeypatch):
    """A row for the same path lands while the scan holds it pending -> its commit
    hits UNIQUE(path). Used to leave the job RUNNING forever."""
    from app.services import audio_scanner

    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    db = sessions()
    lib = AudioLibrary(name="a", path=str(tmp_path))
    db.add(lib)
    db.commit()
    job = Job(type=JobType.AUDIO_SCAN, status=JobStatus.PENDING, library_id=lib.id)
    db.add(job)
    db.commit()
    lib_id, job_id = lib.id, job.id
    db.close()

    def probe_and_collide(path):
        other = sessions()
        other.add(AudioFile(library_id=lib_id, path=path, filename="a.mp3", extension=".mp3"))
        other.commit()
        other.close()
        return {"size": 1, "probe_ok": False, "file_mtime": 0, "file_date": 0}

    monkeypatch.setattr(audio_scanner, "_probe_audio_metadata_guarded", probe_and_collide)
    audio_scanner.scan_audio_library(lib_id, job_id)

    db = sessions()
    job = db.get(Job, job_id)
    assert job.status == JobStatus.FAILED and "UNIQUE" in job.error
    db.close()


def test_video_scan_poisoned_session_still_ends_failed(sessions, tmp_path, monkeypatch):
    from app.models.file import File
    from app.services import scanner

    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    db = sessions()
    lib = Library(name="v", path=str(tmp_path))
    db.add(lib)
    db.commit()
    lib_id = lib.id
    db.close()

    monkeypatch.setattr(scanner, "_find_video_files", lambda _p: [str(f), str(f)])
    scanner.scan_library(lib_id)

    db = sessions()
    job = db.query(Job).filter(Job.type == JobType.SCAN).one()
    assert job.status == JobStatus.FAILED
    assert db.query(File).count() == 0
    db.close()


# --- fail_job ---------------------------------------------------------------------


def test_fail_job_recovers_a_poisoned_session_and_truncates(sessions):
    """The shared handler helper: rollback first, then record the failure."""
    db = sessions()
    job = Job(type=JobType.COMPRESS, status=JobStatus.RUNNING, current_file="x.mkv")
    db.add_all([Job(type="x", status=JobStatus.RUNNING), job])
    db.add(ImageLibrary(name="dup", path="/dup"))
    db.commit()
    jid = job.id
    db.add(ImageLibrary(name="dup2", path="/dup"))  # UNIQUE(path) -> flush fails
    try:
        db.flush()
    except Exception as exc:
        boom = exc
    common.fail_job(db, job, RuntimeError("x" * 2000 + str(boom)))
    db.close()

    db = sessions()
    got = db.get(Job, jid)
    assert got.status == JobStatus.FAILED and len(got.error) == 512
    assert got.current_file is None and got.finished_at is not None
    db.close()
    common.fail_job(db, None, RuntimeError("no job"))  # tolerated


# --- queue safety net -------------------------------------------------------------


def test_queue_marks_crashed_job_failed(sessions):
    from app.queue import _mark_job_crashed

    db = sessions()
    job = Job(type=JobType.IMAGE_SCAN, status=JobStatus.RUNNING)
    done = Job(type=JobType.IMAGE_SCAN, status=JobStatus.COMPLETED)
    db.add_all([job, done])
    db.commit()
    jid, did = job.id, done.id
    db.close()

    _mark_job_crashed(jid, RuntimeError("kaboom"))
    _mark_job_crashed(did, RuntimeError("late"))
    _mark_job_crashed(None, RuntimeError("no job"))

    db = sessions()
    assert db.get(Job, jid).status == JobStatus.FAILED
    assert "kaboom" in db.get(Job, jid).error
    assert db.get(Job, did).status == JobStatus.COMPLETED
    db.close()


# --- lazy image thumbnails ----------------------------------------------------------


def test_get_or_create_image_thumbnail(sessions, tmp_path):
    from app.services.image_scanner import get_or_create_image_thumbnail

    [p] = _make_images(str(tmp_path / "imgs"), 1)
    out = get_or_create_image_thumbnail(42, p)
    assert out == str(tmp_path / "thumbs" / "42.jpg") and os.path.exists(out)
    assert not [n for n in os.listdir(tmp_path / "thumbs") if n.endswith(".tmp")]
    # second call is a hit, and a missing/corrupt source is None, not an error
    assert get_or_create_image_thumbnail(42, p) == out
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image")
    assert get_or_create_image_thumbnail(43, str(bad)) is None
    assert not os.path.exists(tmp_path / "thumbs" / "43.jpg")


def test_thumbnail_endpoint_generates_on_first_request(sessions, tmp_path, client, monkeypatch):
    from app.api import images as images_api

    monkeypatch.setattr(images_api, "SessionLocal", sessions)
    [p] = _make_images(str(tmp_path / "imgs"), 1)
    lib_id, _ = _image_library(sessions, tmp_path / "imgs")
    db = sessions()
    row = ImageFile(library_id=lib_id, path=p, filename="img0.png", extension="png", size=1)
    db.add(row)
    db.commit()
    rid = row.id
    db.close()

    r = client.get(f"/api/images/{rid}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert os.path.exists(tmp_path / "thumbs" / f"{rid}.jpg")
    assert client.get("/api/images/99999/thumbnail").status_code == 404


def test_load_image_for_scan_header_only(tmp_path):
    from app.services.image_scanner import _load_image_for_scan

    [p] = _make_images(str(tmp_path), 1)
    meta, arr = _load_image_for_scan(p, 400, decode=False)
    assert arr is None and meta["width"] == 64 and meta["height"] == 48
    meta, arr = _load_image_for_scan(p, 400)
    assert isinstance(arr, np.ndarray)
