"""Translate a video's English subtitle into another language, offline (RAS-123).

`translate_one` does one file (no DB, cancel-aware); `run_translate_job` is the queue job that
runs a list of them with progress, cancel and a "N/M done before cancel" result, the same shape
as Compress.
"""

import json
import logging
import os
import threading
from collections.abc import Callable

from app.services import machine_subs, srt_io, translate_packs, translate_text, translator

logger = logging.getLogger(__name__)

SOURCE_LANG = "en"


class TranslateError(Exception):
    """An expected, user-facing failure for one file (message is shown on the job)."""


def find_source_subtitle(video_path: str) -> str | None:
    """The real English .srt next to (or under) the video; machine-made ones never count."""
    from app.services.subtitle_service import find_all_subtitle_tracks

    for t in find_all_subtitle_tracks(video_path):
        if t["lang"] == SOURCE_LANG and t["path"].lower().endswith(".srt"):
            if not machine_subs.parse_tagged_suffix(_suffix(video_path, t["path"]))[1]:
                return t["path"]
    return None


def first_problem(video_paths: list[str], lang: str, pack_name: str) -> str | None:
    """Why the first of these videos cannot be translated into `lang`, or None when all can.
    Same folder search as the Subtitles scan, so a real subtitle in `Subs/` counts too."""
    from app.services.subtitle_service import _missing_lang_codes

    for path in video_paths:
        name = os.path.basename(path)
        if find_source_subtitle(path) is None:
            return f"{name} has no English subtitle to translate"
        if lang not in _missing_lang_codes(path, [lang]):
            return f"{name} already has a {pack_name} subtitle"
    return None


def _suffix(video_path: str, sub_path: str) -> str:
    stem = os.path.splitext(os.path.basename(video_path))[0]
    name = os.path.basename(sub_path)
    return name[len(stem) + 1 : name.rfind(".")] if name.startswith(stem + ".") else ""


def translate_one(
    video_path: str,
    lang: str,
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[float], None] | None = None,
    device: str = "cpu",
    device_index: int = 0,
) -> str:
    """Write `<stem>.<lang>.mt.srt` next to the video and return its path. The file appears only
    when complete: output goes to a hidden temp name and is renamed on success, so a cancel or a
    failure leaves nothing behind."""
    pack = translate_packs.get_pack(lang)
    if pack is None:
        raise TranslateError(f"No language pack for '{lang}'.")
    if not translate_packs.is_installed(pack):
        raise TranslateError(f"The {pack['name']} language pack is not installed.")
    source = find_source_subtitle(video_path)
    if source is None:
        raise TranslateError("No English subtitle (.srt) found to translate.")
    try:
        with open(source, encoding="utf-8-sig", errors="replace") as f:
            cues = srt_io.parse_srt(f.read())
    except OSError as e:
        raise TranslateError(f"Could not read {os.path.basename(source)}: {e.strerror}") from e
    if not cues:
        raise TranslateError(f"{os.path.basename(source)} has no subtitle lines.")

    prepared = [translate_text.prepare(c.text) for c in cues]
    translated = translator.translate_texts(
        pack,
        [p.core for p in prepared],
        is_cancelled,
        on_progress=(lambda d, t: on_progress(d / max(t, 1) * 100)) if on_progress else None,
        device=device,
        device_index=device_index,
    )
    rtl = bool(pack.get("rtl"))
    out_cues = [
        srt_io.Cue(c.start, c.end, translate_text.restore(p, t, rtl))
        for c, p, t in zip(cues, prepared, translated, strict=True)
    ]

    final = machine_subs.machine_sub_path(video_path, lang)
    tmp = os.path.join(
        os.path.dirname(final), f".translating-{os.getpid()}-{threading.get_ident()}.srt"
    )
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(srt_io.write_srt(out_cues))
        os.replace(tmp, final)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return final


def _failure_summary(failed: int, total: int, results: list[dict]) -> str:
    first = next((r["error"] for r in results if r.get("error")), "")
    return f"{failed} of {total} file(s) failed" + (f": {first}" if first else "")


def run_translate_job(job_id: int, items: list[dict]) -> None:
    """items: [{"video_path": str, "lang": str}, ...] — one file after another (the model uses
    every core, so files do not run side by side)."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None or job.status == JobStatus.CANCELLED:
            # Cancelled while it waited for a queue slot (the cancel route marks it, but a
            # job already handed to the dispatcher is still called): never start it.
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(items)
        db.commit()
        arm_cancel(job_id)

        results: list[dict] = []
        completed = failed = 0
        cancelled = False
        total = len(items)

        def cancel() -> bool:
            return should_cancel(job_id)

        try:
            for idx, item in enumerate(items):
                if cancel():
                    cancelled = True
                    break
                video, lang = item["video_path"], item["lang"]
                job.current_file = os.path.basename(video)
                db.commit()
                last = {"pct": -1.0}

                def on_progress(frac: float, idx: int = idx, last: dict = last) -> None:
                    if frac - last["pct"] >= 2.0:
                        last["pct"] = frac
                        job.progress = (idx + frac / 100) / total * 100
                        db.commit()

                try:
                    out = translate_one(video, lang, cancel, on_progress)
                    completed += 1
                    results.append({"video_path": video, "lang": lang, "output": out})
                    log(
                        db,
                        job_id,
                        f"Translated {os.path.basename(video)} → {os.path.basename(out)}",
                    )
                except translator.TranslationCancelled:
                    cancelled = True
                    break
                except TranslateError as e:
                    failed += 1
                    results.append({"video_path": video, "lang": lang, "error": str(e)})
                    log(db, job_id, f"{os.path.basename(video)}: {e}", "error")
                except Exception as e:  # a crash in the model must cost one file, not the batch
                    logger.exception("translate %s failed", video)
                    failed += 1
                    results.append(
                        {"video_path": video, "lang": lang, "error": "Translation failed."}
                    )
                    log(db, job_id, f"{os.path.basename(video)}: {type(e).__name__}: {e}", "error")
                job.processed_files = completed + failed
                job.progress = (idx + 1) / total * 100
                db.commit()
        finally:
            translator.release_sessions()

        job.settings = json.dumps({"items": items, "results": results})
        job.current_file = None
        job.finished_at = now()
        if cancelled:
            job.status = JobStatus.CANCELLED
            job.current_file = f"{completed}/{total} done before cancel"
            log(db, job_id, f"Translate cancelled — {completed} done, {failed} failed")
        elif failed and not completed:
            job.status = JobStatus.FAILED
            job.error = _failure_summary(failed, total, results)
        else:
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            if failed:
                job.error = _failure_summary(failed, total, results)
        db.commit()
    except Exception as e:
        logger.exception("translate job %s crashed", job_id)
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()
