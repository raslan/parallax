import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"}
SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}

# Preferred order for browser-renderable subtitles
_BROWSER_SUB_EXTS = [".srt", ".vtt", ".ass", ".ssa", ".sub"]


def _parse_lang(code: str) -> tuple[str, str]:
    """Return (iso_code, display_name) from a language code string."""
    if not code:
        return "und", "Subtitles"
    try:
        from babelfish import Language
        lang = Language.fromalpha2(code) if len(code) == 2 else Language(code)
        return str(lang.alpha2 or code), lang.name
    except Exception:
        return code, code.title()


def find_subtitle_path(video_path: str) -> str | None:
    """Return path to the first subtitle file found alongside the video, or None."""
    import glob
    base = os.path.splitext(video_path)[0]
    for ext in _BROWSER_SUB_EXTS:
        if os.path.exists(base + ext):
            return base + ext
        matches = sorted(glob.glob(f"{glob.escape(base)}.*{ext}"))
        if matches:
            return matches[0]
    return None


def find_all_subtitle_tracks(video_path: str) -> list[dict]:
    """Return all subtitle files alongside the video with language metadata."""
    import glob as _glob
    base = os.path.splitext(video_path)[0]
    seen: set[str] = set()
    tracks = []

    for ext in _BROWSER_SUB_EXTS:
        exact = base + ext
        if os.path.exists(exact) and exact not in seen:
            seen.add(exact)
            tracks.append({"path": exact, "lang": "und", "label": "Subtitles"})

        for m in sorted(_glob.glob(f"{_glob.escape(base)}.*{ext}")):
            if m in seen:
                continue
            seen.add(m)
            # Extract the part between basename and extension (e.g. "en" from "movie.en.srt")
            suffix = m[len(base) + 1: -len(ext)]
            lang, label = _parse_lang(suffix)
            tracks.append({"path": m, "lang": lang, "label": label})

    return tracks


def subtitle_to_vtt(sub_path: str) -> str:
    """Read a subtitle file and return its content as WebVTT."""
    import re
    with open(sub_path, encoding="utf-8-sig", errors="replace") as f:
        content = f.read()
    ext = os.path.splitext(sub_path)[1].lower()
    if ext == ".vtt":
        return content
    if ext == ".srt":
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        content = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", content)
        return "WEBVTT\n\n" + content
    # .ass/.ssa/.sub — not natively renderable; return empty VTT
    return "WEBVTT\n\n"


def find_and_serve_vtt(video_path: str) -> str | None:
    """Find subtitle alongside video and return as VTT string, or None if absent."""
    sub = find_subtitle_path(video_path)
    return subtitle_to_vtt(sub) if sub else None


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


def _build_providers(os_username: str, os_password: str) -> tuple[list[str], dict]:
    if os_username and os_password:
        import hashlib
        hashed = hashlib.md5(os_password.encode()).hexdigest()  # noqa: S324 — OpenSubtitles.org XMLRPC requires MD5
        return ["opensubtitles"], {"opensubtitles": {"username": os_username, "password": hashed}}
    return ["podnapisi"], {}


def _build_lang_set(lang_codes: list[str]):
    langs = set(filter(None, (_to_language(c) for c in lang_codes)))
    return langs or {_to_language("en")}


def search_file(file_path: str, lang_codes: list[str], os_username: str = "", os_password: str = "") -> list[dict]:
    """Return scored subtitle candidates for a single video file."""
    import subliminal

    if not os.path.isfile(file_path):
        raise ValueError("File not found")

    providers, provider_configs = _build_providers(os_username, os_password)
    lang_set = _build_lang_set(lang_codes)

    video = subliminal.scan_video(file_path)
    video.subtitle_languages = set()

    raw: list = []
    with subliminal.core.ProviderPool(providers=providers, provider_configs=provider_configs) as pool:
        for pname in providers:
            try:
                p_subs = pool[pname].list_subtitles(video, lang_set)
                logger.warning("search_file %s: %s → %d candidates", os.path.basename(file_path), pname, len(p_subs))
                raw.extend(p_subs)
            except Exception as exc:
                logger.warning("search_file provider error [%s]: %s: %s", pname, type(exc).__name__, exc)

    serialized = []
    for sub in raw:
        score = subliminal.compute_score(sub, video)
        serialized.append({
            "subtitle_id": str(sub.subtitle_id),
            "provider": sub.provider_name,
            "language": str(sub.language),
            "release": (
                getattr(sub, "movie_full_name", None)
                or getattr(sub, "release", None)
                or str(sub.subtitle_id)
            ),
            "score": score,
            "hearing_impaired": bool(getattr(sub, "hearing_impaired", False)),
        })

    serialized.sort(key=lambda x: x["score"], reverse=True)
    return serialized


def download_one(
    file_path: str,
    provider: str,
    subtitle_id: str,
    language: str,
    os_username: str = "",
    os_password: str = "",
) -> bool:
    """Download a specific subtitle by provider + subtitle_id and save alongside the video."""
    import subliminal

    if not os.path.isfile(file_path):
        raise ValueError("File not found")

    _, provider_configs = _build_providers(os_username, os_password)
    lang_set = _build_lang_set([language])

    video = subliminal.scan_video(file_path)
    video.subtitle_languages = set()

    with subliminal.core.ProviderPool(providers=[provider], provider_configs=provider_configs) as pool:
        candidates = pool.list_subtitles(video, lang_set)
        match = next((s for s in candidates if str(s.subtitle_id) == subtitle_id), None)
        if not match:
            return False
        ok = pool.download_subtitle(match)
        if ok and match.content:
            subliminal.save_subtitles(video, [match])
            return True
    return False


def run_download_job(job_id: int, path: str, lang_codes: list[str], os_username: str = "", os_password: str = "") -> None:
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

        providers, provider_configs = _build_providers(os_username, os_password)
        lang_set = _build_lang_set(lang_codes)

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
                # Clear detected subtitle languages so check_video() doesn't skip files
                # with embedded subtitle tracks — we want external .srt files regardless.
                video.subtitle_languages = set()
                downloaded_subs = []
                with subliminal.core.ProviderPool(providers=providers, provider_configs=provider_configs) as pool:
                    candidates = []
                    for pname in providers:
                        try:
                            p_subs = pool[pname].list_subtitles(video, lang_set)
                            _log(db, job_id, f"  {pname}: {len(p_subs)} candidates")
                            candidates.extend(p_subs)
                        except Exception as perr:
                            _log(db, job_id, f"  {pname}: {type(perr).__name__} — {perr}", level="error")
                    if candidates:
                        downloaded_subs = pool.download_best_subtitles(candidates, video, lang_set, min_score=0)
                if downloaded_subs:
                    subliminal.save_subtitles(video, downloaded_subs)
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


def run_transcribe_job(job_id: int, video_paths: list[str], model_id: str, language: Optional[str] = None) -> None:
    """Background job: transcribe a list of video files with Whisper and save SRT files."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.whisper_service import transcribe

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()

        total = len(video_paths)
        succeeded = 0
        for i, path in enumerate(video_paths):
            if db.get(Job, job_id).status == JobStatus.CANCELLED:
                job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.commit()
                return

            fname = os.path.basename(path)
            job.current_file = fname
            # Show at least 5% immediately so the bar isn't stuck at 0
            job.progress = max(5.0, (i / total) * 100)
            db.commit()
            _log(db, job_id, f"[{i + 1}/{total}] Transcribing: {fname}")

            try:
                out_path = transcribe(path, model_id, language)
                _log(db, job_id, f"Saved: {os.path.basename(out_path)}")
                succeeded += 1
            except Exception as exc:
                _log(db, job_id, f"Error on {fname}: {exc}", level="error")

            # Update progress after this file completes
            job.progress = ((i + 1) / total) * 100
            db.commit()

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        job.current_file = f"{succeeded}/{total} transcribed"
        db.commit()
        _log(db, job_id, f"Done: {succeeded}/{total} files transcribed.")

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    finally:
        from app.services.whisper_service import release_model
        release_model()
        db.close()
