"""Audio duplicate detection is client-side grouping over an extraction-only job —
like video's `find_duplicates`. This job measures which audio files share audio with
which (`services/shared_audio.py`) and writes the result to `AudioFile.shared_audio`;
size / duration / content-date criteria need no extraction (the scan already filled
those columns). The browser (`clusterAudioDuplicates.ts`) does all the grouping.
"""

import logging

from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus
from app.models.settings import get_setting
from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel
from app.services.duplicates import scope_extraction_groups
from app.services.shared_audio import (
    compute_shared_audio,
    describe_plan,
    measured_settings,
    write_shared_audio,
)

logger = logging.getLogger(__name__)


def _funnel_criteria(criteria: dict) -> dict:
    """The video funnel's criteria shape, with the video-only stages off."""
    return {
        "use_size": criteria.get("use_size", False),
        "use_duration": criteria.get("use_duration", False),
        "duration_tolerance": criteria.get("duration_tolerance", 2.0),
        "use_resolution": False,
        "use_content_date": criteria.get("use_content_date", False),
        "content_date_tolerance": criteria.get("content_date_tolerance", 60.0),
        "use_orientation": False,
        "use_bitrate": False,
        "bitrate_tolerance_pct": 10.0,
        "use_filename": False,
        "filename_threshold": 0.4,
    }


def find_audio_duplicates(library_id: int, job_id: int, criteria: dict) -> None:
    """Extraction only: measure shared audio for the files that survive the free criteria
    (size / duration / content date), inside the groups those criteria form."""
    db = SessionLocal()
    job = db.get(Job, job_id)
    if job is None:
        db.close()
        return
    use_audio = criteria.get("use_audio", True)
    job.status = JobStatus.RUNNING
    job.started_at = now()
    if use_audio:
        # What the stored shared-audio values will be measured with, so the page can tell
        # later (even after a reload) whether the sliders still match them.
        job.settings = measured_settings(criteria)
    db.commit()
    arm_cancel(job_id)

    cancelled = False
    try:
        # Plain column values, not ORM rows: the commits below would expire ORM rows, and a
        # file deleted while a long run is going would make touching its row raise.
        rows = (
            db.query(
                AudioFile.id,
                AudioFile.path,
                AudioFile.size,
                AudioFile.duration,
                AudioFile.file_date,
                AudioFile.filename,
            )
            .filter(AudioFile.library_id == library_id)
            .all()
        )
        job.total_files = len(rows)
        db.commit()

        if use_audio:
            plain = [
                {
                    "id": r.id,
                    "path": r.path,
                    "size": r.size,
                    "duration": r.duration,
                    "file_width": None,
                    "file_height": None,
                    "file_date": r.file_date,
                    "video_bitrate": None,
                    "filename": r.filename,
                }
                for r in rows
            ]
            groups = scope_extraction_groups(plain, _funnel_criteria(criteria))
            # What the job really works on: the tracks that survived the other criteria.
            n_files = sum(len(g) for g in groups if len(g) > 1)
            job.total_files = n_files
            workers = max(1, int(get_setting(db, "scan_prefetch", "4")))
            # End the open transaction: the fingerprinting below can run for a long time and
            # must not hold a pooled connection while it does.
            db.commit()

            def _progress(p: float) -> None:
                job.progress = min(99.0, p * 100.0)
                # Fingerprinting is the first half of the bar, one count per track.
                job.processed_files = min(n_files, int(p * 2 * n_files))
                db.commit()

            def _plan(files: int, group_count: int, pairs: int) -> None:
                message, level = describe_plan(files, group_count, pairs)
                log(db, job_id, message, level)

            shared = compute_shared_audio(
                [[(f["id"], f["path"]) for f in group] for group in groups],
                workers=workers,
                is_cancelled=lambda: should_cancel(job_id),
                on_progress=_progress,
                on_plan=_plan,
                similarity=criteria.get("audio_similarity", 0.75),
                min_stretch_s=criteria.get("audio_min_stretch", 10.0),
                kind="audio",
            )
            if shared is None:
                cancelled = True
            else:
                # A file deleted during the run is simply skipped, and the previous run's
                # values for every file are replaced, never mixed with this run's.
                write_shared_audio(
                    db, AudioFile.__table__, AudioFile.library_id == library_id, shared
                )
                job.processed_files = len(shared)
                db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.exception("audio duplicate scan crashed: %s", exc)
        clear_cancel(job_id)
        fail_job(db, job, exc)
        db.close()
        return

    clear_cancel(job_id)
    job.status = JobStatus.CANCELLED if cancelled else JobStatus.COMPLETED
    if not cancelled:
        job.progress = 100.0
    job.finished_at = now()
    db.commit()
    db.close()
