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

from sqlalchemy import and_, case, func
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


def _in_range(query, days: int | None):
    cutoff = _since(days)
    return query.filter(StatEvent.ts >= cutoff) if cutoff is not None else query


# Aggregation happens in SQL so the cost doesn't grow with the number of events.
# A restore is not a job; a job counts as done only when it completed.
_IS_JOB = StatEvent.kind != RESTORE_KIND
_IS_DONE = and_(_IS_JOB, StatEvent.status == JobStatus.COMPLETED)


def _sum_if(condition, column):
    return func.coalesce(func.sum(case((condition, column), else_=0)), 0)


# Bytes count from every event that has both sizes: a cancelled or failed Compress still
# replaced the files it got through, and a restore takes some of that back.
_SAVED = func.coalesce(
    func.sum(
        case(
            (
                and_(StatEvent.bytes_in.isnot(None), StatEvent.bytes_out.isnot(None)),
                StatEvent.bytes_in - StatEvent.bytes_out,
            ),
            else_=0,
        )
    ),
    0,
)


def summary(db: Session, days: int | None = None) -> dict:
    jobs, done, files, b_in, b_out, saved, seconds, busy, first = _in_range(
        db.query(
            _sum_if(_IS_JOB, 1),
            _sum_if(_IS_DONE, 1),
            _sum_if(_IS_DONE, StatEvent.files),
            func.coalesce(func.sum(StatEvent.bytes_in), 0),
            func.coalesce(func.sum(StatEvent.bytes_out), 0),
            _SAVED,
            _sum_if(_IS_DONE, StatEvent.media_seconds),
            _sum_if(_IS_JOB, StatEvent.duration_s),
            func.min(StatEvent.ts),
        ),
        days,
    ).one()
    return {
        "jobs": int(jobs),
        "jobs_completed": int(done),
        "files": int(files),
        "bytes_in": int(b_in),
        "bytes_out": int(b_out),
        "bytes_saved": int(saved),
        "media_seconds": float(seconds),
        "busy_seconds": float(busy),
        "first_event": first,
    }


def _bucket_key(ts: datetime, bucket: str) -> str:
    if bucket == "month":
        return ts.strftime("%Y-%m-01")
    if bucket == "week":
        monday = ts - timedelta(days=ts.weekday())
        return monday.strftime("%Y-%m-%d")
    return ts.strftime("%Y-%m-%d")


def timeseries(
    db: Session, bucket: str = "day", days: int | None = 30, tz_offset: int = 0
) -> list[dict]:
    """Per-bucket jobs/files (completed jobs) and bytes saved (any event), ascending.

    Days are cut in the caller's timezone: `tz_offset` is JavaScript's
    `getTimezoneOffset()` (minutes UTC is ahead of local time), so a job run just before
    local midnight lands on the day the user saw it happen. Grouping is one SQL row per
    day; weeks and months are rolled up from those.
    """
    day = func.strftime("%Y-%m-%d", func.datetime(StatEvent.ts, f"{-int(tz_offset):+d} minutes"))
    per_day = (
        _in_range(
            db.query(day, _sum_if(_IS_DONE, 1), _sum_if(_IS_DONE, StatEvent.files), _SAVED),
            days,
        )
        .group_by(day)
        .all()
    )
    rows: dict[str, dict] = {}
    for date_str, jobs, files, saved in per_day:
        key = _bucket_key(datetime.strptime(date_str, "%Y-%m-%d"), bucket)
        row = rows.setdefault(key, {"t": key, "jobs": 0, "files": 0, "bytes_saved": 0})
        row["jobs"] += int(jobs)
        row["files"] += int(files)
        row["bytes_saved"] += int(saved)
    return [rows[k] for k in sorted(rows)]


_BREAKDOWN_FIELDS = {"kind": "kind", "media": "media", "status": "status"}


def breakdown(db: Session, by: str = "kind", days: int | None = None) -> list[dict]:
    """Group events by `kind`, `media` or `status`; biggest savers first."""
    column = getattr(StatEvent, _BREAKDOWN_FIELDS[by])
    rows = (
        _in_range(
            db.query(column, func.count(), func.coalesce(func.sum(StatEvent.files), 0), _SAVED),
            days,
        )
        .filter(_IS_JOB)
        .group_by(column)
        .all()
    )
    groups = [
        {"key": key, "jobs": int(jobs), "files": int(files), "bytes_saved": int(saved)}
        for key, jobs, files, saved in rows
    ]
    return sorted(groups, key=lambda g: (-g["bytes_saved"], -g["jobs"], g["key"]))


def clear(db: Session) -> int:
    """Delete every stat event; returns how many were removed."""
    count = db.query(StatEvent).delete(synchronize_session=False)
    db.commit()
    return count
