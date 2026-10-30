"""Durable, file-agnostic usage statistics.

Every finished job is reduced to one `StatEvent` row (see `models/stats.py`). Runners
that know how many bytes they read and wrote call `note_bytes()` while they work; the
queue then calls `record_finished_job()` once the job function returns, which folds
those bytes into the job's event. Recording never raises into the job path.
"""

import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.job import Job, JobStatus, JobType
from app.models.stats import StatEvent

logger = logging.getLogger(__name__)

MEDIA_BY_JOB_TYPE = {
    JobType.SCAN: "video",
    JobType.TRANSCODE: "video",
    JobType.DUPLICATES: "video",
    JobType.COMPRESS: "video",
    JobType.PHASH_SCAN: "video",
    JobType.TOOLBOX_FIX: "video",
    JobType.SPLICE_MERGE: "video",
    JobType.SUBTITLE_DOWNLOAD: "video",
    JobType.SUBTITLE_SYNC: "video",
    JobType.IMAGE_SCAN: "image",
    JobType.IMAGE_DUPLICATES: "image",
    JobType.IMAGE_CONTENT_SCAN: "image",
    JobType.AUDIO_SCAN: "audio",
    JobType.AUDIO_COMPRESS: "audio",
    JobType.AUDIO_TOOLBOX: "audio",
    JobType.AUDIO_DUPLICATES: "audio",
}

# Not a job: the reversal written when an original is restored (see `record_restore`).
RESTORE_KIND = "restore"
# Not a queue job either, but it is user work: files removed from a library.
REMOVAL_KIND = "delete"

# Housekeeping the user didn't ask for; a stat for it would only be noise.
_SKIPPED_TYPES = {JobType.THUMBNAIL_WARM, JobType.MODEL_DOWNLOAD}
_TERMINAL = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}

_noted: dict[int, dict[str, float]] = defaultdict(lambda: {"in": 0, "out": 0, "seconds": 0.0})
_noted_lock = threading.Lock()


def note_bytes(job_id: int, bytes_in: int, bytes_out: int, media_seconds: float = 0.0) -> None:
    """Add one processed file's input/output size to the running job's tally."""
    with _noted_lock:
        tally = _noted[job_id]
        tally["in"] += max(0, int(bytes_in))
        tally["out"] += max(0, int(bytes_out))
        tally["seconds"] += max(0.0, float(media_seconds))


def _pop_noted(job_id: int) -> dict[str, float] | None:
    with _noted_lock:
        return _noted.pop(job_id, None)


def record_finished_job(job_id: int | None) -> None:
    """Write the stat event for a job that just ended. Safe to call for any job id."""
    if job_id is None:
        return
    noted = _pop_noted(job_id)
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None or job.type in _SKIPPED_TYPES or job.status not in _TERMINAL:
            return
        duration = 0.0
        if job.started_at and job.finished_at:
            duration = max(0.0, (job.finished_at - job.started_at).total_seconds())
        db.add(
            StatEvent(
                kind=job.type,
                media=MEDIA_BY_JOB_TYPE.get(job.type, "other"),
                status=job.status,
                duration_s=duration,
                files=job.processed_files or 0,
                bytes_in=int(noted["in"]) if noted else None,
                bytes_out=int(noted["out"]) if noted else None,
                media_seconds=noted["seconds"] if noted and noted["seconds"] else None,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("could not record stats for job %s", job_id)
    finally:
        db.close()


# ─── Aggregation ──────────────────────────────────────────────────────────────


def record_restore(media: str, bytes_original: int, bytes_current: int | None) -> None:
    """Take back the space a restored original had saved.

    Restoring swaps the compressed file (or nothing, after a Cleanup) for its
    original, so the library grows by `bytes_original - bytes_current`. The event
    stores the negated sizes, which cancels the matching compress event in every
    sum while counting as no job.
    """
    # No current file means the original was removed by Cleanup, not compressed.
    _add_event(
        StatEvent(
            kind=RESTORE_KIND,
            media=media,
            status=JobStatus.COMPLETED,
            bytes_in=-int(bytes_original),
            bytes_out=-int(bytes_current or 0),
        )
    )


def record_removal(media: str, files: int, bytes_removed: int) -> None:
    """Credit files removed from a library (Cleanup, duplicates, image delete).

    Counted whether or not the originals are kept: like Compress, the saving is
    credited when the library shrinks. Call after the request's own commit so the
    separate session below doesn't contend for SQLite's write lock.
    """
    if files <= 0:
        return
    _add_event(
        StatEvent(
            kind=REMOVAL_KIND,
            media=media,
            status=JobStatus.COMPLETED,
            files=files,
            bytes_in=max(0, int(bytes_removed)),
            bytes_out=0,
        )
    )


def _add_event(event: StatEvent) -> None:
    db = SessionLocal()
    try:
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("could not record stats event")
    finally:
        db.close()


def _since(days: int | None) -> datetime | None:
    return datetime.utcnow() - timedelta(days=days) if days else None


def _events(db: Session, days: int | None) -> list[StatEvent]:
    query = db.query(StatEvent)
    cutoff = _since(days)
    if cutoff is not None:
        query = query.filter(StatEvent.ts >= cutoff)
    return query.order_by(StatEvent.ts).all()


def _saved(event: StatEvent) -> int:
    """Bytes saved by one event; 0 when it has no before/after sizes."""
    if event.bytes_in is None or event.bytes_out is None:
        return 0
    return event.bytes_in - event.bytes_out


def summary(db: Session, days: int | None = None) -> dict:
    events = _events(db, days)
    jobs = [e for e in events if e.kind != RESTORE_KIND]
    done = [e for e in jobs if e.status == JobStatus.COMPLETED]
    # Bytes count from every event: a cancelled or failed Compress still replaced the
    # files it got through, and a restore (not a job) takes some of that back.
    sized = events
    return {
        "jobs": len(jobs),
        "jobs_completed": len(done),
        "files": sum(e.files for e in done),
        "bytes_in": sum(e.bytes_in or 0 for e in sized),
        "bytes_out": sum(e.bytes_out or 0 for e in sized),
        "bytes_saved": sum(_saved(e) for e in sized),
        "media_seconds": sum(e.media_seconds or 0.0 for e in done),
        "busy_seconds": sum(e.duration_s for e in jobs),
        "first_event": events[0].ts if events else None,
    }


def _bucket_key(ts: datetime, bucket: str) -> str:
    if bucket == "month":
        return ts.strftime("%Y-%m-01")
    if bucket == "week":
        monday = ts - timedelta(days=ts.weekday())
        return monday.strftime("%Y-%m-%d")
    return ts.strftime("%Y-%m-%d")


def timeseries(db: Session, bucket: str = "day", days: int | None = 30) -> list[dict]:
    """Per-bucket jobs/files (completed jobs) and bytes saved (any event), ascending."""
    rows: dict[str, dict] = {}
    for e in _events(db, days):
        key = _bucket_key(e.ts, bucket)
        row = rows.setdefault(key, {"t": key, "jobs": 0, "files": 0, "bytes_saved": 0})
        if e.kind != RESTORE_KIND and e.status == JobStatus.COMPLETED:
            row["jobs"] += 1
            row["files"] += e.files
        row["bytes_saved"] += _saved(e)
    return [rows[k] for k in sorted(rows)]


_BREAKDOWN_FIELDS = {"kind": "kind", "media": "media", "status": "status"}


def breakdown(db: Session, by: str = "kind", days: int | None = None) -> list[dict]:
    """Group events by `kind`, `media` or `status`; biggest savers first."""
    attr = _BREAKDOWN_FIELDS[by]
    groups: dict[str, dict] = {}
    for e in _events(db, days):
        if e.kind == RESTORE_KIND:
            continue
        key = getattr(e, attr)
        g = groups.setdefault(key, {"key": key, "jobs": 0, "files": 0, "bytes_saved": 0})
        g["jobs"] += 1
        g["files"] += e.files
        g["bytes_saved"] += _saved(e)
    return sorted(groups.values(), key=lambda g: (-g["bytes_saved"], -g["jobs"], g["key"]))


def clear(db: Session) -> int:
    """Delete every stat event; returns how many were removed."""
    count = db.query(StatEvent).delete(synchronize_session=False)
    db.commit()
    return count
