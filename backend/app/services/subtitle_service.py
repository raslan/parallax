import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"}
SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}


def _to_language(code: str):
    from babelfish import Language
    code = code.strip().lower()
    try:
        if len(code) == 2:
            return Language.fromalpha2(code)
        return Language(code)
    except Exception:
        return None


def _has_subtitle(video_path: str, lang_codes: list[str]) -> bool:
    base = os.path.splitext(video_path)[0]
    for ext in SUBTITLE_EXTENSIONS:
        if os.path.exists(f"{base}{ext}"):
            return True
        for lang in lang_codes:
            if os.path.exists(f"{base}.{lang}{ext}"):
                return True
    return False


def scan_directory(root_path: str, lang_codes: list[str]) -> list[dict]:
    """Walk directory and return video files with subtitle status, grouped by relative dir."""
    from guessit import guessit as _guessit

    results = []
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames.sort()
        for fname in sorted(filenames):
            if os.path.splitext(fname)[1].lower() not in VIDEO_EXTENSIONS:
                continue

            full_path = os.path.join(dirpath, fname)
            rel_dir = os.path.relpath(dirpath, root_path)

            info = _guessit(fname)
            has_sub = _has_subtitle(full_path, lang_codes)

            results.append({
                "path": full_path,
                "filename": fname,
                "relative_dir": "" if rel_dir == "." else rel_dir,
                "has_subtitle": has_sub,
                "title": str(info.get("title", "")),
                "season": info.get("season"),
                "episode": info.get("episode"),
                "year": info.get("year"),
                "media_type": info.get("type", "unknown"),
            })

    return results


def run_download_job(job_id: int, path: str, lang_codes: list[str], os_api_key: str = "") -> None:
    import subliminal

    from app.database import SessionLocal
    from app.models.job import Job, JobLog, JobStatus

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()

        # Collect all video files
        video_paths = []
        for dirpath, _, filenames in os.walk(path):
            for fname in sorted(filenames):
                if os.path.splitext(fname)[1].lower() in VIDEO_EXTENSIONS:
                    video_paths.append(os.path.join(dirpath, fname))

        if not video_paths:
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.current_file = "No video files found"
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            return

        job.total_files = len(video_paths)
        db.commit()

        # Build provider list — podnapisi always, opensubtitlescom if key present
        providers = ["podnapisi"]
        provider_configs: dict = {}
        if os_api_key:
            providers.append("opensubtitlescom")
            provider_configs["opensubtitlescom"] = {"api_key": os_api_key}

        # Build babelfish Language set
        lang_set = set(filter(None, (_to_language(c) for c in lang_codes))) or {_to_language("en")}

        found = skipped = failed = 0

        for i, video_path in enumerate(video_paths):
            if db.get(Job, job_id).status == JobStatus.CANCELLED:
                break

            fname = os.path.basename(video_path)
            job.current_file = fname
            job.processed_files = i
            job.progress = (i / len(video_paths)) * 99
            db.commit()

            if _has_subtitle(video_path, lang_codes):
                skipped += 1
                _log(db, job_id, f"Skipped (subtitle exists): {fname}")
                continue

            try:
                video = subliminal.scan_video(video_path)
                subs = subliminal.download_best_subtitles(
                    [video],
                    lang_set,
                    providers=providers,
                    provider_configs=provider_configs,
                )
                downloaded = subs.get(video, [])
                if downloaded:
                    subliminal.save_subtitles(video, downloaded)
                    found += 1
                    _log(db, job_id, f"Downloaded: {fname}")
                else:
                    failed += 1
                    _log(db, job_id, f"Not found: {fname}", level="warning")
            except Exception as exc:
                failed += 1
                _log(db, job_id, f"Error on {fname}: {exc}", level="error")
                logger.exception("Subtitle download error for %s", video_path)

        job.processed_files = len(video_paths)
        job.progress = 100.0
        job.status = JobStatus.COMPLETED
        job.current_file = f"{found} downloaded, {skipped} skipped, {failed} not found"
        job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()

    except Exception as exc:
        logger.exception("Subtitle job %d failed", job_id)
        try:
            job = db.get(Job, job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _log(db, job_id: int, message: str, level: str = "info") -> None:
    from app.models.job import JobLog
    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()
