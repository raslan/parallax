"""Shared state and utilities for background job workers."""

import contextlib
import os
import threading
from collections import Counter
from datetime import UTC, datetime

from app.config import SCRATCH_DIR


def is_ignored_media_name(name: str) -> bool:
    """True for filenames that a library walk must never pick up as media.

    Dotfiles and in-progress encode temps (`.compressing*` / `.transcoding*`).
    Mirrors `fs_watcher._Handler._is_relevant` — that filter only guards live
    watcher events, so the scanner / reconcile disk walks need the same check or
    a half-written temp file gets inserted as a real row.
    """
    return name.startswith(".") or ".compressing" in name or ".transcoding" in name


def temp_sibling_path(src: str, ext: str, infix: str) -> str:
    """A short, collision-free temp path for in-progress media output — in
    `SCRATCH_DIR` if that's actually mounted (a fast disk staging area, opt-in
    purely by bind-mounting something there), otherwise next to `src`.

    Deliberately does NOT derive from the source basename: a source name already
    near NAME_MAX (255 bytes) plus an infix overflows and ffmpeg fails with
    "... File name too long". Use a fixed short name keyed by pid + thread id
    instead — one worker thread processes one file at a time, so that's unique
    even when every in-flight file shares one scratch directory.
    `infix` ("compressing" / "transcoding") keeps the fs-watcher skipping it.
    """
    directory = SCRATCH_DIR if os.path.isdir(SCRATCH_DIR) else os.path.dirname(src)
    return os.path.join(
        directory,
        f".{infix}-{os.getpid()}-{threading.get_ident()}{ext}",
    )


def now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def log(db, job_id: int, message: str, level: str = "info") -> None:
    from app.models.job import JobLog

    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()


def fail_job(db, job, exc: Exception) -> None:
    """Mark `job` FAILED from an `except` handler.

    Rolls the session back first: the usual cause is a failed flush (e.g. a
    UNIQUE violation), which leaves the session unusable until rolled back —
    committing straight away raises again, the exception escapes the handler,
    and the job is left RUNNING forever.
    """
    from app.models.job import JobStatus

    if job is None:
        return
    db.rollback()
    job.status = JobStatus.FAILED
    job.error = str(exc)
    job.finished_at = now()
    db.commit()


# Serializes filesystem-watcher applies against scan start-up. A scan takes it
# just long enough to register itself (see `library_scan_active`), so a watcher
# apply is either fully finished before the scan snapshots the library's rows,
# or sees the scan registered and stands down. Never held for a scan's duration.
apply_lock = threading.Lock()

_active_scans: Counter[tuple[str, int]] = Counter()
_active_scans_guard = threading.Lock()


@contextlib.contextmanager
def library_scan_active(kind: str, library_id: int):
    """Mark a library (`kind` = "video" | "image" | "audio") as mid-scan.

    The filesystem watcher's whole-library reconcile inserts rows for every
    on-disk path it doesn't know yet. Run alongside a long scan it inserted the
    paths the scan hadn't reached, and the scan's own INSERT then died on
    UNIQUE(path). While registered here, the watcher leaves the library alone;
    the scan owns it and the next reconcile after it finishes catches anything
    that arrived meanwhile.
    """
    key = (kind, library_id)
    with apply_lock:  # waits out an in-flight watcher apply on this library
        with _active_scans_guard:
            _active_scans[key] += 1
    try:
        yield
    finally:
        with _active_scans_guard:
            _active_scans[key] -= 1
            if _active_scans[key] <= 0:
                del _active_scans[key]


def scan_active(kind: str, library_id: int) -> bool:
    with _active_scans_guard:
        return _active_scans.get((kind, library_id), 0) > 0


# job_id → True means "please stop at next checkpoint"
_cancel_flags: dict[int, bool] = {}


def request_cancel(job_id: int) -> None:
    _cancel_flags[job_id] = True


def should_cancel(job_id: int) -> bool:
    return _cancel_flags.get(job_id, False)


def clear_cancel(job_id: int) -> None:
    _cancel_flags.pop(job_id, None)


def arm_cancel(job_id: int) -> None:
    """Mark job as cancellable — only if a cancel hasn't already been requested."""
    if not _cancel_flags.get(job_id, False):
        _cancel_flags[job_id] = False
