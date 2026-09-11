"""Shared state and utilities for background job workers."""

import os
import threading
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
