"""Plan and run subtitle downloads.

`search_candidates` is the read-only plan step: it asks each chosen source for candidates and
reports a source that failed or does not apply as a named entry instead of raising. Results are
cached in memory for a few minutes so a reload re-plans cheaply. The sources pace their own
requests (`Politeness`).

`run_subtitle_job` is the approved-items job: one item at a time, each a download, a write beside
the video and an optional sync, with a per-item result stored on the job as it goes.
"""

import json
import logging
import os
import threading
import time
from collections.abc import Callable

from app.services import subtitle_files, subtitle_names, subtitle_service
from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel
from app.services.srt_io import decode_srt, parse_srt
from app.services.subtitle_preview import _LEGACY_ENCODINGS
from app.services.subtitle_providers import (
    MAX_SUBTITLE_BYTES,
    Identity,
    ProviderError,
    SearchQuery,
    get_provider,
)
from app.services.subtitle_sync import sync_subtitle

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 600
CACHE_MAX_ENTRIES = 512

_CACHE: dict[tuple, tuple[float, list[dict]]] = {}
_CACHE_LOCK = threading.Lock()


# ---------------------------------------------------------------- plan search


def _cache_key(provider: str, q: SearchQuery) -> tuple:
    ident = q.identity.imdb_id or (q.identity.title.strip().lower(), q.identity.year)
    return (provider, ident, tuple(q.languages), q.season, q.episode)


def _cache_put(key: tuple, found: list[dict], at: float) -> None:
    """Store a result; expired entries go first, then the oldest beyond `CACHE_MAX_ENTRIES`."""
    with _CACHE_LOCK:
        for k in [k for k, (t, _) in _CACHE.items() if at - t >= CACHE_TTL_SECONDS]:
            del _CACHE[k]
        _CACHE.pop(key, None)  # re-inserted last, so dict order stays oldest first
        _CACHE[key] = (at, [dict(c) for c in found])
        while len(_CACHE) > CACHE_MAX_ENTRIES:
            del _CACHE[next(iter(_CACHE))]


def _not_applicable(media_types: frozenset[str]) -> str:
    return "Films only" if media_types == frozenset({"movie"}) else "TV only"


def search_candidates(
    q: SearchQuery, providers: list[str], clock: Callable[[], float] = time.monotonic
) -> dict:
    """`{"candidates": [...best first...], "errors": [{"provider", "message"}]}`. Never raises
    for a source's own failure: each becomes an error entry and the other sources still count."""
    candidates: list[dict] = []
    errors: list[dict] = []
    for name in dict.fromkeys(providers):
        key = _cache_key(name, q)
        with _CACHE_LOCK:
            hit = _CACHE.get(key)
        if hit is not None and clock() - hit[0] < CACHE_TTL_SECONDS:
            candidates.extend(dict(c) for c in hit[1])
            continue
        try:
            p = get_provider(name)
        except ValueError:
            errors.append({"provider": name, "message": "Unknown source"})
            continue
        try:
            if q.identity.type not in p.media_types:
                errors.append({"provider": name, "message": _not_applicable(p.media_types)})
                continue
            found = p.search(q)
        except ProviderError as exc:
            errors.append({"provider": name, "message": str(exc)})
            continue
        except Exception as exc:  # a parser or network surprise: still a named entry
            logger.warning("subtitle search %s failed: %s: %s", name, type(exc).__name__, exc)
            errors.append(
                {"provider": name, "message": f"The search failed ({type(exc).__name__})"}
            )
            continue
        finally:
            p.close()
        _cache_put(key, found, clock())
        candidates.extend(found)
    candidates.sort(key=lambda c: c.get("score", 0), reverse=True)
    return {"candidates": candidates, "errors": errors}


# ---------------------------------------------------------------- writing


_PATH_LOCKS: dict[str, threading.Lock] = {}
_PATH_LOCKS_GUARD = threading.Lock()


def _path_lock(path: str) -> threading.Lock:
    key = os.path.realpath(path)
    with _PATH_LOCKS_GUARD:
        return _PATH_LOCKS.setdefault(key, threading.Lock())


def _write_atomic(path: str, data: bytes) -> None:
    """Write via a temp file in the same folder + `os.replace`, under a per-path lock, so two
    writers of one path never leave a mixed or half-written file, nor a temp file behind."""
    with _path_lock(path):
        tmp = f"{path}.{os.getpid()}-{threading.get_ident()}.tmp"
        try:
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise


def save_subtitle(
    video_path: str, language: str, provider: str, data: bytes, ext: str, keep_existing: bool
) -> tuple[str, str | None]:
    """Put a downloaded subtitle beside the video; returns its path and, if removing the
    machine-made files afterwards failed, why (the new file is saved either way). Without
    `keep_existing` it becomes the plain `<stem>.<lang><ext>` (overwriting one) and the
    generated / translated files of that language go; with it, a plain file that exists is left
    alone and the new one is labelled with its source (`subf2m`, `subf2m-2`, ...)."""
    cleanup_error = None
    with subtitle_files._WRITE_LOCK:  # no rename or make-main interleaves with the choice
        plain = subtitle_names.subtitle_path(video_path, language, ext=ext)
        target = plain
        if keep_existing and os.path.exists(plain):
            target = subtitle_names.variant_path(video_path, language, provider, keep=True, ext=ext)
        _write_atomic(target, data)
        if not keep_existing:
            try:
                subtitle_service.remove_machine_made(video_path, language)
            except OSError as exc:
                cleanup_error = (
                    f"Saved, but the generated or translated file could not be removed: "
                    f"{exc.strerror or exc}"
                )
    return target, cleanup_error


def _payload(data: bytes, language: str) -> tuple[bytes, str]:
    """The bytes to write and the extension, or ProviderError if this is no subtitle file.

    The decode is only trusted where it is certain: a UTF-16 file (BOM) and a file in the
    language's usual legacy code page are written as UTF-8; valid UTF-8 and anything else
    (cp1250, GBK, Shift-JIS...) are written exactly as downloaded, for the player to detect."""
    out = data
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            text = data.decode("utf-16")
        except UnicodeDecodeError:
            raise ProviderError("The download is not a readable subtitle file.") from None
        out = text.encode("utf-8")  # many TVs cannot read a UTF-16 .srt
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            legacy = _LEGACY_ENCODINGS.get(language.lower().split("-")[0])
            text = None
            if legacy:
                try:
                    text = data.decode(legacy)
                    out = text.encode("utf-8")
                except UnicodeDecodeError:
                    pass
            if text is None:
                text = decode_srt(data)  # only to check it is a subtitle; bytes stay as they are
    if parse_srt(text):
        return out, ".srt"
    if "[script info]" in text[:2000].lower():
        return out, ".ass"
    raise ProviderError("The download is not a readable subtitle file.")


def _download(provider: str, subtitle_id: str, language: str) -> tuple[bytes, str]:
    """The subtitle's bytes and its extension; ProviderError with the reason otherwise."""
    try:
        p = get_provider(provider)
    except ValueError as exc:
        raise ProviderError(str(exc)) from exc
    try:
        data = p.download(subtitle_id)
    except ValueError as exc:
        raise ProviderError(str(exc)) from exc
    finally:
        p.close()
    if not data:
        raise ProviderError("The source returned no subtitle for that choice.")
    if len(data) > MAX_SUBTITLE_BYTES:
        raise ProviderError("The download is too large to be a subtitle file.")
    return _payload(data, language)


def _run_item(item: dict, keep_existing: bool, sync_after: bool, engine: str) -> dict:
    video = item["video_path"]
    result = {"video_path": video, "language": item["language"]}
    try:
        if not os.path.isfile(video):
            raise ProviderError("That video no longer exists.")
        data, ext = _download(item["provider"], item["subtitle_id"], item["language"])
        path, cleanup_error = save_subtitle(
            video, item["language"], item["provider"], data, ext, keep_existing
        )
    except ProviderError as exc:
        return {**result, "status": "failed", "error": str(exc)}
    except OSError as exc:
        return {**result, "status": "failed", "error": f"Could not save: {exc.strerror or exc}"}
    result.update(status="saved", path=path)
    if cleanup_error:
        result["cleanup_error"] = cleanup_error
    if sync_after or item.get("sync"):
        try:
            sync_subtitle(video, path, engine)
            result["synced"] = True
        except Exception as exc:
            logger.warning("sync after download failed for %s: %s", path, exc)
            result["sync_error"] = str(exc)[:300]
    return result


# ---------------------------------------------------------------- the job


def _update_job(job_id: int, **fields) -> None:
    """One short-lived session per write: none is held across a download or a sync."""
    from app.database import SessionLocal
    from app.models.job import Job

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        db.commit()
    finally:
        db.close()


def _log_job(job_id: int, message: str, level: str = "info") -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        log(db, job_id, message, level)
    finally:
        db.close()


def run_subtitle_job(
    job_id: int, items: list[dict], keep_existing: bool, sync_after: bool, engine: str | None
) -> None:
    """items: `[{"video_path", "language", "provider", "subtitle_id", "sync"}]`, approved by the
    user. A failing item costs only itself; every item failing fails the job."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.models.settings import get_setting

    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return  # cancelled while it waited for a queue slot
            job.status = JobStatus.RUNNING
            job.started_at = now()
            job.total_files = len(items)
            db.commit()
            engine = engine or get_setting(db, "subtitle_sync_engine", "alass")
            try:
                stored = json.loads(job.settings or "{}")
            except ValueError:
                stored = {}
        finally:
            db.close()
        arm_cancel(job_id)

        total = len(items)
        results: list[dict] = []
        cancelled = False
        for i, it in enumerate(items):
            if should_cancel(job_id):
                cancelled = True
                break
            _update_job(
                job_id,
                current_file=os.path.basename(it["video_path"]),
                processed_files=i,
                progress=i / total * 99,
            )
            results.append(_run_item(it, keep_existing, sync_after, engine))
            _update_job(
                job_id,
                processed_files=i + 1,
                settings=json.dumps({**stored, "results": results}),
            )

        saved = sum(r["status"] == "saved" for r in results)
        failed = sum(r["status"] == "failed" for r in results)
        done = len(results)
        fields: dict = {"finished_at": now(), "processed_files": done}
        if cancelled:
            results += [
                {"video_path": it["video_path"], "language": it["language"], "status": "skipped"}
                for it in items[done:]
            ]
            fields.update(
                status=JobStatus.CANCELLED, current_file=f"{done} of {total} done before cancel"
            )
        elif failed and not saved:
            first = next(r["error"] for r in results if r.get("error"))
            fields.update(status=JobStatus.FAILED, error=first[:512], current_file=None)
        else:
            fields.update(
                status=JobStatus.COMPLETED,
                progress=100.0,
                current_file=f"{saved} saved, {failed} failed" if failed else f"{saved} saved",
            )
        fields["settings"] = json.dumps({**stored, "results": results})
        _update_job(job_id, **fields)
    except Exception as exc:
        logger.exception("Subtitle run job %d failed", job_id)
        db = SessionLocal()
        try:
            fail_job(db, db.get(Job, job_id), exc)
        except Exception:
            logger.exception("Could not mark subtitle run job %d failed", job_id)
        finally:
            db.close()
    finally:
        clear_cancel(job_id)


# ---------------------------------------------------------------- compat (until Task 16)


def run_folder_download(job_id: int, path: str, lang_codes: list[str]) -> None:
    """The old page's folder-wide download, rebuilt on the new run: every video under `path`
    missing a real subtitle in a language gets the best candidate per missing language."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.models.settings import get_setting

    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return
            job.status = JobStatus.RUNNING
            job.started_at = now()
            db.commit()
            tmdb_key = get_setting(db, "tmdb_api_key", "").strip()
        finally:
            db.close()
        arm_cancel(job_id)

        videos = [
            os.path.join(d, f)
            for d, _, names in os.walk(path)
            for f in sorted(names)
            if os.path.splitext(f)[1].lower() in subtitle_service.VIDEO_EXTENSIONS
        ]
        items: list[dict] = []
        errors: list[str] = []
        for video in videos:
            if should_cancel(job_id):
                _update_job(
                    job_id,
                    status=JobStatus.CANCELLED,
                    finished_at=now(),
                    current_file=f"0 of {len(videos)} done before cancel",
                )
                return
            missing = subtitle_service._missing_lang_codes(video, lang_codes)
            if not missing:
                continue
            _update_job(job_id, current_file=os.path.basename(video))
            info = subtitle_service._video_info(video)
            kind = "tv" if info["is_episode"] else "movie"
            imdb_id = None
            providers = ["subf2m"]
            if kind == "movie" and tmdb_key:
                try:
                    imdb_id = subtitle_service.resolve_imdb_id(
                        info["title"], info["year"], kind, tmdb_key
                    )
                except Exception as exc:
                    logger.warning("TMDB lookup failed for %s: %s", video, exc)
                if imdb_id:
                    providers.append("yts")
            q = SearchQuery(
                identity=Identity(info["title"], info["year"], kind, imdb_id=imdb_id),
                languages=tuple(missing),
                season=(info["season"] or 1) if kind == "tv" else None,
                episode=(info["episode"] or 1) if kind == "tv" else None,
                video_path=video,
            )
            found = search_candidates(q, providers)
            for e in found["errors"]:
                reason = f"{e['provider']}: {e['message']}"
                if reason not in errors:  # one line per distinct failure, not one per video
                    errors.append(reason)
                    _log_job(job_id, f"Search failed, {reason}", "error")
            seen: set[str] = set()
            for c in found["candidates"]:
                lang = c.get("language")
                if lang in missing and lang not in seen:
                    seen.add(lang)
                    items.append(
                        {
                            "video_path": video,
                            "language": lang,
                            "provider": c.get("provider", "subf2m"),
                            "subtitle_id": c["subtitle_id"],
                            "sync": False,
                        }
                    )

        if not items and errors:
            _update_job(
                job_id,
                status=JobStatus.FAILED,
                finished_at=now(),
                current_file=None,
                error=errors[0][:512],
            )
            return
        if not items:
            _update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=100.0,
                finished_at=now(),
                current_file="Nothing to download",
            )
            return
        run_subtitle_job(job_id, items, False, False, None)
    except Exception as exc:
        logger.exception("Subtitle folder download %d failed", job_id)
        db = SessionLocal()
        try:
            fail_job(db, db.get(Job, job_id), exc)
        except Exception:
            logger.exception("Could not mark subtitle job %d failed", job_id)
        finally:
            db.close()
    finally:
        clear_cancel(job_id)
