"""The shared get-or-create thumbnail mechanism (video library, image library, Organize)."""

import os
import threading

from app.services import image_scanner, scanner
from app.services import thumbnail_common as tc


def _sem():
    return threading.Semaphore(1)


def test_hit_returns_without_generating_and_calls_on_hit(tmp_path):
    out = tmp_path / "t.jpg"
    out.write_bytes(b"jpg")
    hits: list[str] = []
    calls: list[int] = []
    got = tc.get_or_create(
        str(out),
        lambda: calls.append(1) or True,
        semaphore=_sem(),
        failed_path=str(tmp_path / "t.jpg.failed"),
        on_hit=hits.append,
    )
    assert got == str(out) and calls == [] and hits == [str(out)]


def test_success_returns_out_path(tmp_path):
    out = tmp_path / "t.jpg"

    def gen():
        out.write_bytes(b"jpg")
        return True

    assert tc.get_or_create(str(out), gen, semaphore=_sem()) == str(out)


def test_failure_writes_marker_and_is_not_retried(tmp_path):
    out, failed = tmp_path / "d" / "t.jpg", tmp_path / "d" / "t.jpg.failed"
    calls: list[int] = []
    hits: list[str] = []

    def gen():
        calls.append(1)
        return False

    kw = {"semaphore": _sem(), "failed_path": str(failed), "on_hit": hits.append}
    assert tc.get_or_create(str(out), gen, **kw) is None
    assert failed.exists()  # parent dir created for the marker
    assert tc.get_or_create(str(out), gen, **kw) is None
    assert calls == [1] and hits == [str(failed)]


def test_failure_without_marker_path_retries(tmp_path):
    calls: list[int] = []
    out = str(tmp_path / "t.jpg")
    for _ in range(2):
        assert tc.get_or_create(out, lambda: calls.append(1) or False, semaphore=_sem()) is None
    assert calls == [1, 1] and list(tmp_path.iterdir()) == []


def test_generation_runs_under_lock_and_semaphore(tmp_path):
    lock, sem = threading.Lock(), threading.Semaphore(1)
    seen: dict = {}

    def gen():
        seen["locked"] = lock.locked()
        seen["sem_taken"] = not sem.acquire(blocking=False)
        return False

    tc.get_or_create(str(tmp_path / "t.jpg"), gen, semaphore=sem, lock=lambda: lock)
    assert seen == {"locked": True, "sem_taken": True}


def test_lock_factory_is_not_called_on_a_hit(tmp_path):
    out = tmp_path / "t.jpg"
    out.write_bytes(b"jpg")
    made: list[int] = []
    tc.get_or_create(
        str(out), lambda: True, semaphore=_sem(), lock=lambda: made.append(1) or threading.Lock()
    )
    assert made == []


def test_rechecks_after_acquiring_the_lock(tmp_path):
    """A concurrent request that finished while we waited on the lock is reused."""
    out = tmp_path / "t.jpg"
    lock = threading.Lock()

    class Racing:
        def __enter__(self):
            out.write_bytes(b"jpg")  # "another thread" finished first
            return lock.__enter__()

        def __exit__(self, *a):
            return lock.__exit__(*a)

    called: list[int] = []
    got = tc.get_or_create(
        str(out), lambda: called.append(1), semaphore=_sem(), lock=lambda: Racing()
    )
    assert got == str(out) and called == []


def test_generator_exception_propagates(tmp_path):
    def gen():
        raise OSError("boom")

    try:
        tc.get_or_create(str(tmp_path / "t.jpg"), gen, semaphore=_sem())
    except OSError as e:
        assert str(e) == "boom"
    else:
        raise AssertionError("expected OSError")


# ── library callers: behaviour pinned across the refactor ───────────────────


def test_video_library_thumbnail_success_failure_marker(tmp_path, monkeypatch):
    monkeypatch.setattr(scanner, "THUMBNAILS_DIR", str(tmp_path / "thumbs"))
    calls: list[tuple] = []

    def frame(src, out, duration=None):
        calls.append((src, out, duration))
        if "bad" in src:
            return False
        with open(out, "wb") as fh:
            fh.write(b"jpg")
        return True

    monkeypatch.setattr(scanner, "grab_frame", frame)
    out = scanner.get_or_create_thumbnail(7, "/m/good.mkv", duration=12.0)
    assert out == str(tmp_path / "thumbs" / "7.jpg")
    assert calls == [("/m/good.mkv", out, 12.0)]
    assert scanner.get_or_create_thumbnail(7, "/m/good.mkv") == out and len(calls) == 1

    assert scanner.get_or_create_thumbnail(8, "/m/bad.mkv") is None
    assert (tmp_path / "thumbs" / "8.jpg.failed").exists()
    assert scanner.get_or_create_thumbnail(8, "/m/bad.mkv") is None and len(calls) == 2
    scanner.clear_thumbnail_failed_marker(8)
    assert scanner.get_or_create_thumbnail(8, "/m/bad.mkv") is None and len(calls) == 3


def test_video_library_thumbnail_pre_deletes_a_stale_file(tmp_path, monkeypatch):
    """generate_thumbnail removes a reused id's old jpg before ffmpeg runs."""
    thumbs = tmp_path / "thumbs"
    thumbs.mkdir()
    monkeypatch.setattr(scanner, "THUMBNAILS_DIR", str(thumbs))
    seen: list[bool] = []
    monkeypatch.setattr(
        scanner, "grab_frame", lambda s, o, d=None: seen.append(os.path.exists(o)) or False
    )
    (thumbs / "9.jpg").write_bytes(b"old")
    assert scanner.get_or_create_thumbnail(9, "/m/x.mkv") == str(thumbs / "9.jpg")  # a hit
    (thumbs / "9.jpg").write_bytes(b"old")
    assert scanner.generate_thumbnail("/m/x.mkv", 9) is False
    assert seen == [False] and not (thumbs / "9.jpg").exists()


def test_image_library_thumbnail_failure_leaves_no_marker_and_retries(tmp_path, monkeypatch):
    monkeypatch.setattr(image_scanner, "THUMBNAIL_DIR", str(tmp_path / "thumbs"))
    calls: list[str] = []

    def bad(src, out):
        calls.append(out)
        with open(out, "wb") as fh:
            fh.write(b"half")
        raise OSError("decode")

    monkeypatch.setattr(image_scanner, "generate_thumbnail", bad)
    (tmp_path / "thumbs").mkdir()
    for _ in range(2):
        assert image_scanner.get_or_create_image_thumbnail(5, "/m/x.png") is None
    assert len(calls) == 2 and calls[0].endswith(".tmp")
    assert list((tmp_path / "thumbs").iterdir()) == []  # no marker, temp removed


def test_semaphores_are_public_and_shared_by_the_scanners():
    assert tc.THUMBNAIL_GEN_LIMIT >= 1
    assert scanner.VIDEO_THUMB_SEMAPHORE is tc.VIDEO_THUMB_SEMAPHORE
    assert image_scanner.IMAGE_THUMB_SEMAPHORE is tc.IMAGE_THUMB_SEMAPHORE
    assert tc.VIDEO_THUMB_SEMAPHORE is not tc.IMAGE_THUMB_SEMAPHORE
