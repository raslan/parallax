"""Audio duplicate detection is client-side clustering over an extraction-only
job — exactly like video's `find_duplicates`. This job populates
`AudioFile.audio_fingerprint`; size / duration / content-date criteria need no
extraction (they read columns the scan already filled). The browser
(`clusterAudioDuplicates.ts`) does all comparison.
"""

import json
import logging
import os

from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus
from app.services.audio_fingerprint import compute_audio_fingerprint
from app.services.common import arm_cancel, clear_cancel, now, should_cancel

logger = logging.getLogger(__name__)

_COMMIT_EVERY = 25


def extract_audio_fingerprints(library_id: int, job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    if job is None:
        db.close()
        return
    job.status = JobStatus.RUNNING
    job.started_at = now()
    db.commit()
    arm_cancel(job_id)

    cancelled = False
    failed = False
    error: str | None = None
    processed = 0
    try:
        rows = (
            db.query(AudioFile)
            .filter(
                AudioFile.library_id == library_id,
                AudioFile.audio_fingerprint.is_(None),
            )
            .all()
        )
        total = len(rows)
        job.total_files = total
        db.commit()

        for i, row in enumerate(rows):
            if should_cancel(job_id):
                cancelled = True
                break
            if not os.path.isfile(row.path):
                continue
            try:
                fp = compute_audio_fingerprint(row.path, job_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("audio fingerprint failed for %s: %s", row.path, exc)
                fp = None
            if fp:
                row.audio_fingerprint = json.dumps(fp)
            processed += 1
            if (i + 1) % _COMMIT_EVERY == 0:
                job.processed_files = processed
                job.progress = min(99.0, (i + 1) / max(1, total) * 100)
                db.commit()
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.exception("audio fingerprint extraction crashed: %s", exc)
        failed = True
        error = str(exc)
    finally:
        clear_cancel(job_id)
        job = db.get(Job, job_id)
        if job is not None:
            job.processed_files = processed
            if cancelled:
                job.status = JobStatus.CANCELLED
            elif failed:
                job.status = JobStatus.FAILED
                job.error = error
            else:
                job.status = JobStatus.COMPLETED
                job.progress = 100.0
            job.finished_at = now()
            db.commit()
        db.close()
