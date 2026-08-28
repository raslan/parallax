import logging
import os
import re
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"}
SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}

# Preferred order for browser-renderable subtitles
_BROWSER_SUB_EXTS = [".srt", ".vtt", ".ass", ".ssa", ".sub"]

_QUERY_YEAR_RE = re.compile(r"[(\[]\s*((?:19|20)\d{2})\s*[)\]]")


def _parse_query(query: str) -> tuple[str, int | None]:
    """Split a typed search query into (title, year). Only a bracketed year
    like "(2012)" or "[2012]" is treated as a year filter — a bare trailing
    number is ambiguous with titles like "Blade Runner 2049" or "2012" (the
    movie), so it's left as part of the title rather than guessed at."""
    q = re.sub(r"[._]", " ", query).strip()
    year = None
    m = _QUERY_YEAR_RE.search(q)
    if m:
        year = int(m.group(1))
        q = q[: m.start()] + q[m.end() :]
    q = re.sub(r"\s+", " ", q).strip(" ()._-")
    return q, year


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
            suffix = m[len(base) + 1 : -len(ext)]
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


def _has_subtitle(video_path: str, lang_codes: list[str]) -> bool:
    """True if any subtitle file exists alongside the video (used for display)."""
    base = os.path.splitext(video_path)[0]
    for ext in SUBTITLE_EXTENSIONS:
        if os.path.exists(f"{base}{ext}"):
            return True
        for lang in lang_codes:
            if os.path.exists(f"{base}.{lang}{ext}"):
                return True
    return False


def _missing_lang_codes(video_path: str, lang_codes: list[str]) -> list[str]:
    """Return lang_codes that don't have a tagged subtitle file yet."""
    base = os.path.splitext(video_path)[0]
    missing = []
    for lang in lang_codes:
        found = any(os.path.exists(f"{base}.{lang}{ext}") for ext in SUBTITLE_EXTENSIONS)
        if not found:
            missing.append(lang)
    return missing


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
            missing = set(_missing_lang_codes(full_path, lang_codes))
            languages = {lang: lang not in missing for lang in lang_codes}

            results.append(
                {
                    "path": full_path,
                    "filename": fname,
                    "relative_dir": "" if rel_dir == "." else rel_dir,
                    "has_subtitle": len(missing) == 0,
                    "languages": languages,
                    "title": str(info.get("title", "")),
                    "season": info.get("season"),
                    "episode": info.get("episode"),
                    "year": info.get("year"),
                    "media_type": info.get("type", "unknown"),
                }
            )

    return results


def _video_info(file_path: str) -> dict:
    """Extract title/year/season/episode/type from filename via guessit."""
    from guessit import guessit as _guessit

    info = _guessit(os.path.basename(file_path))
    return {
        "title": str(info.get("title", "")),
        "year": info.get("year"),
        "season": info.get("season"),
        "episode": info.get("episode"),
        "is_episode": info.get("type") == "episode",
    }


def resolve_imdb_id(title: str, year: int | None, media_type: str, tmdb_api_key: str) -> str | None:
    """Look up an IMDB ID via TMDB — yts-subs has no title-search endpoint of
    its own, so this is required before it can be queried."""
    from app.services import tmdb as tmdb_service

    kind = "tv" if media_type == "tv" else "movie"
    results = tmdb_service.search(title, kind, tmdb_api_key)
    if year is not None:
        results = [r for r in results if r.get("year") == year] or results
    if not results:
        return None
    return tmdb_service.get_imdb_id(results[0]["tmdb_id"], kind, tmdb_api_key)


def search_file(
    file_path: str,
    lang_codes: list[str],
    query: str | None = None,
    year: int | None = None,
    media_type: str | None = None,
    season: int | None = None,
    episode: int | None = None,
    provider: str = "subf2m",
    tmdb_api_key: str | None = None,
) -> list[dict]:
    """Return subtitle candidates for a single video file from the given provider.

    query/media_type/season/episode let a caller override the filename-guessed
    metadata (manual search) instead of trusting guessit, which is often wrong
    for badly-named files — exactly the files this feature exists to help with.

    If `year` is passed explicitly (e.g. from a TMDB pick, which already has an
    authoritative title + year), it's used as-is and `query` is NOT regex-parsed
    for a bracketed year — no guessing needed when the caller already knows.
    Otherwise `query` falls back to `_parse_query`'s "(YYYY)" convention.
    """
    if not os.path.isfile(file_path):
        raise ValueError("File not found")

    info = _video_info(file_path)
    is_episode = (media_type == "tv") if media_type else info["is_episode"]

    if year is not None:
        title_override, year_override = (query.strip() if query and query.strip() else None), year
    elif query and query.strip():
        title_override, year_override = _parse_query(query)
    else:
        title_override, year_override = None, None

    title = title_override or info["title"]
    resolved_year = year_override or info["year"]

    if provider == "ytssubs":
        if not tmdb_api_key:
            raise ValueError("TMDB API key required for YTS-Subs")
        from app.services.ytssubs_provider import YtsSubsProvider

        imdb_id = resolve_imdb_id(
            title, resolved_year, "tv" if is_episode else "movie", tmdb_api_key
        )
        yts = YtsSubsProvider()
        try:
            results = yts.search(imdb_id, lang_codes) if imdb_id else []
            logger.info(
                "search_file ytssubs: %d candidates for %s",
                len(results),
                os.path.basename(file_path),
            )
        except Exception as exc:
            logger.warning("search_file ytssubs error: %s: %s", type(exc).__name__, exc)
            results = []
        finally:
            yts.close()
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    from app.services.subf2m_provider import Subf2mProvider

    sub = Subf2mProvider()
    try:
        results = sub.search(
            video_path=file_path,
            lang_codes=lang_codes,
            is_episode=is_episode,
            title=title,
            year=resolved_year,
            season=season or info["season"] or 1,
            episode=episode or info["episode"] or 1,
        )
        logger.info(
            "search_file subf2m: %d candidates for %s", len(results), os.path.basename(file_path)
        )
    except Exception as exc:
        logger.warning("search_file subf2m error: %s: %s", type(exc).__name__, exc)
        results = []
    finally:
        sub.close()

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def download_one(file_path: str, provider: str, subtitle_id: str, language: str) -> bool:
    """Download a specific subtitle by provider + subtitle_id and save alongside the video."""
    if not os.path.isfile(file_path):
        raise ValueError("File not found")

    if provider == "ytssubs":
        from app.services.ytssubs_provider import YtsSubsProvider

        p = YtsSubsProvider()
    else:
        from app.services.subf2m_provider import Subf2mProvider

        p = Subf2mProvider()
    try:
        content = p.download(subtitle_id)
    finally:
        p.close()
    if not content:
        return False
    base = os.path.splitext(file_path)[0]
    out_path = f"{base}.{language}.srt"
    with open(out_path, "wb") as fh:
        fh.write(content)
    return True


def run_download_job(job_id: int, path: str, lang_codes: list[str]) -> None:
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import arm_cancel, clear_cancel, should_cancel

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        arm_cancel(job_id)

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
            job.finished_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
            return

        job.total_files = len(video_paths)
        db.commit()

        from app.models.settings import get_setting
        from app.services.subf2m_provider import Subf2mProvider

        tmdb_api_key = get_setting(db, "tmdb_api_key", "").strip()

        found = skipped = failed = 0
        was_cancelled = False
        subf2m = Subf2mProvider()
        yts = None
        if tmdb_api_key:
            from app.services.ytssubs_provider import YtsSubsProvider

            yts = YtsSubsProvider()

        try:
            for i, video_path in enumerate(video_paths):
                if should_cancel(job_id):
                    was_cancelled = True
                    break

                fname = os.path.basename(video_path)
                job.current_file = fname
                job.processed_files = i
                job.progress = (i / len(video_paths)) * 99
                db.commit()

                missing = _missing_lang_codes(video_path, lang_codes)
                if not missing:
                    skipped += 1
                    _log(db, job_id, f"Skipped (all languages present): {fname}")
                    continue

                try:
                    info = _video_info(video_path)
                    downloaded = False
                    seen_langs: set[str] = set()
                    base = os.path.splitext(video_path)[0]

                    # --- subf2m (primary) — one subtitle per missing language ---
                    try:
                        candidates = subf2m.search(
                            video_path=video_path,
                            lang_codes=missing,
                            is_episode=info["is_episode"],
                            title=info["title"],
                            year=info["year"],
                            season=info["season"] or 1,
                            episode=info["episode"] or 1,
                        )
                        _log(db, job_id, f"  subf2m: {len(candidates)} candidates")
                        # Group by language; take first (highest-score) candidate per lang
                        for candidate in candidates:
                            lang = candidate["language"]
                            if lang in seen_langs:
                                continue
                            content = subf2m.download(candidate["subtitle_id"])
                            if content:
                                out_path = f"{base}.{lang}.srt"
                                with open(out_path, "wb") as fh:
                                    fh.write(content)
                                seen_langs.add(lang)
                                downloaded = True
                                _log(db, job_id, f"Downloaded via subf2m [{lang}]: {fname}")
                    except Exception as sf_err:
                        _log(
                            db,
                            job_id,
                            f"  subf2m: {type(sf_err).__name__} — {sf_err}",
                            level="error",
                        )

                    # --- ytssubs (fallback) — only for languages subf2m didn't find ---
                    still_missing = [lang for lang in missing if lang not in seen_langs]
                    if yts and still_missing:
                        try:
                            imdb_id = resolve_imdb_id(
                                info["title"],
                                info["year"],
                                "tv" if info["is_episode"] else "movie",
                                tmdb_api_key,
                            )
                            candidates = yts.search(imdb_id, still_missing) if imdb_id else []
                            _log(db, job_id, f"  ytssubs: {len(candidates)} candidates")
                            for candidate in candidates:
                                lang = candidate["language"]
                                if lang in seen_langs:
                                    continue
                                content = yts.download(candidate["subtitle_id"])
                                if content:
                                    out_path = f"{base}.{lang}.srt"
                                    with open(out_path, "wb") as fh:
                                        fh.write(content)
                                    seen_langs.add(lang)
                                    downloaded = True
                                    _log(db, job_id, f"Downloaded via ytssubs [{lang}]: {fname}")
                        except Exception as yts_err:
                            _log(
                                db,
                                job_id,
                                f"  ytssubs: {type(yts_err).__name__} — {yts_err}",
                                level="error",
                            )

                    if downloaded:
                        found += 1
                    else:
                        failed += 1
                        _log(db, job_id, f"Not found: {fname}", level="warning")
                except Exception as exc:
                    failed += 1
                    _log(db, job_id, f"Error on {fname}: {exc}", level="error")
                    logger.exception("Subtitle download error for %s", video_path)
        finally:
            subf2m.close()
            if yts:
                yts.close()

        clear_cancel(job_id)
        job.processed_files = len(video_paths)
        job.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.current_file = (
                f"Cancelled — {found} downloaded, {skipped} skipped, {failed} not found"
            )
        else:
            job.progress = 100.0
            job.status = JobStatus.COMPLETED
            job.current_file = f"{found} downloaded, {skipped} skipped, {failed} not found"
        db.commit()

    except Exception as exc:
        logger.exception("Subtitle job %d failed", job_id)
        try:
            job = db.get(Job, job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job.finished_at = datetime.now(UTC).replace(tzinfo=None)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _log(db, job_id: int, message: str, level: str = "info") -> None:
    from app.models.job import JobLog

    db.add(JobLog(job_id=job_id, message=message, level=level))
    db.commit()


def run_transcribe_job(
    job_id: int, video_paths: list[str], model_id: str, language: str | None = None
) -> None:
    """Background job: transcribe a list of video files with Whisper and save SRT files."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import arm_cancel, clear_cancel, should_cancel
    from app.services.whisper_service import transcribe

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        arm_cancel(job_id)

        total = len(video_paths)
        succeeded = 0
        was_cancelled = False
        for i, path in enumerate(video_paths):
            if should_cancel(job_id):
                was_cancelled = True
                break

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

        clear_cancel(job_id)
        job.finished_at = datetime.now(UTC).replace(tzinfo=None)
        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.current_file = f"Cancelled — {succeeded}/{total} transcribed"
        else:
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.current_file = f"{succeeded}/{total} transcribed"
        db.commit()
        _log(db, job_id, f"Done: {succeeded}/{total} files transcribed.")

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
    finally:
        from app.services.whisper_service import release_model

        release_model()
        db.close()
