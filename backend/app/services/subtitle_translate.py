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

from app.services import srt_io, subtitle_names, translate_packs, translate_text, translator

logger = logging.getLogger(__name__)

SOURCE_LANG = "en"


class TranslateError(Exception):
    """An expected, user-facing failure for one file (message is shown on the job)."""


def list_sources(video_path: str) -> list[dict]:
    """Every English .srt next to (or under) the video that can be translated: real, then
    hearing impaired, then machine-made (generated, translated) ones. The user picks which one
    to translate. The models translate from English only, so other languages are not offered.
    The video's plain `<stem>.en.srt` leads the real ones."""
    from app.services.subtitle_service import find_all_subtitle_tracks

    stem = os.path.splitext(os.path.basename(video_path))[0]
    plain = f"{stem}.{SOURCE_LANG}.srt"
    found = [
        {
            "path": t["path"],
            "filename": os.path.basename(t["path"]),
            "machine_made": bool(t["machine_made"]),
            "hearing_impaired": bool(t["hearing_impaired"]),
        }
        for t in find_all_subtitle_tracks(video_path)
        if t["lang"] == SOURCE_LANG and t["path"].lower().endswith(".srt")
    ]
    # stable sort: real, then hearing impaired, then machine-made; the plain file first
    return sorted(
        found,
        key=lambda s: (s["machine_made"], s["hearing_impaired"], s["filename"] != plain),
    )


def find_source_subtitle(video_path: str) -> str | None:
    """The English .srt used when the caller did not pick one: the video's main English file
    (`<stem>.en.srt`), else the first real one, else a machine-made one."""
    sources = list_sources(video_path)
    return sources[0]["path"] if sources else None


def first_problem(video_paths: list[str], source: str | None = None) -> str | None:
    """Why the first of these videos cannot be translated, or None when all can. A chosen
    `source` must be one of the video's own English subtitle files (a path from the client is
    never read otherwise). An existing subtitle in the target language is not a problem: the
    output is always a machine-made file beside it."""
    for path in video_paths:
        name = os.path.basename(path)
        if source is not None:
            if source not in {s["path"] for s in list_sources(path)}:
                return f"{os.path.basename(source)} is not an English subtitle of {name}"
        elif find_source_subtitle(path) is None:
            return f"{name} has no English subtitle to translate"
    return None


def translate_one(
    video_path: str,
    lang: str,
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[float], None] | None = None,
    device: str = "cpu",
    device_index: int = 0,
    drop_hi: bool = False,
    source: str | None = None,
    keep_existing: bool = False,
) -> str:
    """Write `<stem>.<lang>.translated.srt` next to the video (`translated-2`, ... with
    `keep_existing`, otherwise an earlier one is overwritten) and return its path. The file appears
    only when complete: output goes to a hidden temp name and is renamed on success, so a cancel
    or a failure leaves nothing behind. Sound notes and speaker labels are translated and kept
    unless `drop_hi` is set."""
    pack = translate_packs.get_pack(lang)
    if pack is None:
        raise TranslateError(f"No language pack for '{lang}'.")
    if not translate_packs.is_installed(pack):
        raise TranslateError(f"The {pack['name']} language pack is not installed.")
    # `source` is the subtitle file the user picked; without one, a real English file is used.
    source = source or find_source_subtitle(video_path)
    if source is None:
        raise TranslateError("No English subtitle (.srt) found to translate.")
    try:
        with open(source, "rb") as f:
            cues = srt_io.parse_srt(srt_io.decode_srt(f.read()))
    except OSError as e:
        raise TranslateError(f"Could not read {os.path.basename(source)}: {e.strerror}") from e
    if not cues:
        raise TranslateError(f"{os.path.basename(source)} has no subtitle lines.")

    prepared = [translate_text.prepare(c.text, drop_hi) for c in cues]
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
        srt_io.Cue(c.start, c.end, text)
        for c, p, t in zip(cues, prepared, translated, strict=True)
        # a cue that was only a dropped note has nothing left to show
        if (text := translate_text.restore(p, t, rtl)) or not drop_hi
    ]

    final = subtitle_names.variant_path(
        video_path, lang, subtitle_names.TRANSLATED, keep=keep_existing
    )
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


def _gpu_devices(db) -> list:
    """The cards this job may use (none unless the NVIDIA package is installed and switched on)."""
    from app.services import gpu_accel

    enabled, count = gpu_accel.read_settings(db)
    return gpu_accel.job_devices(enabled, count)


def finish_job(db, job, outcomes: list, results: list[dict], noun: str, extra: dict) -> None:
    """Write a finished (or cancelled) item job's result, in Compress's wording: a cancel
    reads 'N/M done before cancel', a batch where every file failed is FAILED."""
    from app.models.job import JobStatus
    from app.services.common import log, now

    total = len(outcomes)
    completed = sum(o.status == "done" for o in outcomes)
    failed = sum(o.status == "failed" for o in outcomes)
    cancelled = any(o.status in ("cancelled", "skipped") for o in outcomes)
    job.settings = json.dumps({**extra, "results": results})
    job.current_file = None
    job.finished_at = now()
    job.processed_files = completed + failed
    if cancelled:
        job.status = JobStatus.CANCELLED
        job.current_file = f"{completed}/{total} done before cancel"
        log(db, job.id, f"{noun} cancelled — {completed} done, {failed} failed")
    elif failed and not completed:
        job.status = JobStatus.FAILED
        job.error = _failure_summary(failed, total, results)
    else:
        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        if failed:
            job.error = _failure_summary(failed, total, results)
    db.commit()


def run_translate_job(job_id: int, items: list[dict]) -> None:
    """items: [{"video_path", "lang", "drop_hi", "source", "keep_existing"}, ...] (`source` = the
    chosen English subtitle file, or None; `keep_existing` writes `translated-2`, ... beside an
    earlier `translated` file instead of replacing it). On the processor the files run one after
    another (the model uses every core); with the NVIDIA package each runs on its own card."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services import item_runner
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
        total = len(items)
        devices = _gpu_devices(db)
        if devices:
            log(db, job_id, f"Using {len(devices)} GPU(s): " + ", ".join(d.label for d in devices))

        def cancel() -> bool:
            return should_cancel(job_id)

        def work(idx: int, item: dict, ctx) -> dict:
            try:
                out = translate_one(
                    item["video_path"],
                    item["lang"],
                    cancel,
                    ctx.progress,
                    device=ctx.device,
                    device_index=ctx.device_index,
                    drop_hi=bool(item.get("drop_hi")),
                    source=item.get("source"),
                    keep_existing=bool(item.get("keep_existing")),
                )
            except translator.TranslationCancelled:
                raise item_runner.ItemCancelled() from None
            except TranslateError as e:
                raise item_runner.ItemFailed(str(e)) from None
            ctx.log(f"Translated {os.path.basename(item['video_path'])} → {os.path.basename(out)}")
            return {"output": out}

        fractions = [0.0] * total
        running: list[int] = []

        def on_progress(idx: int, frac: float) -> None:
            fractions[idx] = frac
            job.progress = sum(fractions) / total
            db.commit()

        def show_current() -> None:
            job.current_file = (
                os.path.basename(items[running[0]]["video_path"]) if running else None
            )
            db.commit()

        def on_start(idx: int) -> None:
            running.append(idx)
            show_current()

        def on_end(idx: int) -> None:
            if idx in running:
                running.remove(idx)
            fractions[idx] = 100.0
            show_current()

        try:
            outcomes = item_runner.run_items(
                items,
                work,
                devices,
                cancel,
                on_progress,
                lambda msg, level: log(db, job_id, msg, level),
                on_start=on_start,
                on_end=on_end,
                generic_error="Translation failed.",
            )
        finally:
            translator.release_sessions()

        results = []
        for item, o in zip(items, outcomes, strict=True):
            row = {"video_path": item["video_path"], "lang": item["lang"], **o.result}
            if o.error:
                row["error"] = o.error
                log(db, job_id, f"{os.path.basename(item['video_path'])}: {o.error}", "error")
            if o.status in ("done", "failed"):
                results.append(row)
        finish_job(db, job, outcomes, results, "Translate", {"items": items})
    except Exception as e:
        logger.exception("translate job %s crashed", job_id)
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()
