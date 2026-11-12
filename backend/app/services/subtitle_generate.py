"""Generate an English subtitle from a video's audio with Whisper, offline (RAS-125).

A stopgap for a release that has no subtitle yet. The result is a machine-made
`<name>.en.mt.srt` (see `machine_subs`), so the scan still wants a real subtitle and replaces
this one when it appears. `generate_one` does one file (no DB, cancel-aware); `run_generate_job`
is the queue job: progress, cancel with "N/M done before cancel", and an optional chain that
translates the result into other installed languages.
"""

import logging
import os
import shutil
import tempfile
import textwrap
import threading
from collections.abc import Callable

from app.config import SCRATCH_DIR
from app.database import DATA_DIR
from app.services import (
    machine_subs,
    speech,
    srt_io,
    subtitle_translate,
    translate_packs,
    translator,
)

logger = logging.getLogger(__name__)

LANGUAGE = "en"  # English audio only, for now
LINE_WIDTH = 42


def _cues(segments: list[tuple[float, float, str]]) -> list[srt_io.Cue]:
    return [
        srt_io.Cue(start, end, "\n".join(textwrap.wrap(text, LINE_WIDTH)) or text)
        for start, end, text in segments
        if text.strip()
    ]


def generate_one(
    video_path: str,
    model: dict,
    language: str | None,
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[float], None] | None = None,
    device: str = "cpu",
    device_index: int = 0,
) -> str:
    """Write `<stem>.en.mt.srt` next to the video and return its path. The audio goes to a
    temporary folder and the subtitle to a hidden temp name renamed on success, so a cancel or a
    failure leaves nothing behind."""
    if not translate_packs.is_installed(model):
        raise subtitle_translate.TranslateError(f"The {model['name']} model is not installed.")
    work_root = SCRATCH_DIR if os.path.isdir(SCRATCH_DIR) else DATA_DIR
    work = tempfile.mkdtemp(prefix="parallax-stt-", dir=work_root)
    final = machine_subs.machine_sub_path(video_path, LANGUAGE)
    tmp = os.path.join(
        os.path.dirname(final), f".generating-{os.getpid()}-{threading.get_ident()}.srt"
    )
    try:
        audio = os.path.join(work, "audio.f32")
        speech.extract_audio(video_path, audio, is_cancelled)
        duration = os.path.getsize(audio) / 4 / speech.SAMPLE_RATE
        segments, _lang = speech.transcribe(
            model,
            audio,
            duration,
            language,
            is_cancelled,
            on_progress=on_progress,
            device=device,
            device_index=device_index,
        )
        cues = _cues(segments)
        if not cues:
            raise subtitle_translate.TranslateError("No speech was found in the audio.")
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(srt_io.write_srt(cues))
        os.replace(tmp, final)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        if os.path.exists(tmp):
            os.remove(tmp)
    return final


def run_generate_job(job_id: int, items: list[dict], translate_to: list[str]) -> None:
    """items: [{"video_path": str, "model": "whisper-small"}, ...]. `translate_to`: languages to
    translate each generated subtitle into afterwards. On the processor the files run one after
    another; with the NVIDIA package each runs on its own card, generation and translation of
    one file staying on that file's card."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services import item_runner
    from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None or job.status == JobStatus.CANCELLED:
            return  # cancelled while it waited for a queue slot: never start
        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(items)
        db.commit()
        arm_cancel(job_id)
        total = len(items)
        steps = 1 + len(translate_to)  # generation, then one translation per language
        devices = subtitle_translate._gpu_devices(db)
        if devices:
            log(db, job_id, f"Using {len(devices)} GPU(s): " + ", ".join(d.label for d in devices))

        def cancel() -> bool:
            return should_cancel(job_id)

        def work(idx: int, item: dict, ctx) -> dict:
            video = item["video_path"]
            name = os.path.basename(video)
            result: dict = {}
            try:
                model = translate_packs.get_pack(item["model"])
                if model is None:
                    raise subtitle_translate.TranslateError("Unknown speech model.")
                out = generate_one(
                    video,
                    model,
                    LANGUAGE,
                    cancel,
                    lambda f: ctx.progress(f / steps),
                    device=ctx.device,
                    device_index=ctx.device_index,
                )
                result["output"] = out
                ctx.log(f"Generated {name} → {os.path.basename(out)}")
                for step, lang in enumerate(translate_to, 1):
                    translated = subtitle_translate.translate_one(
                        video,
                        lang,
                        cancel,
                        lambda f, step=step: ctx.progress((step * 100 + f) / steps),
                        device=ctx.device,
                        device_index=ctx.device_index,
                        source=out,
                    )
                    result.setdefault("translations", []).append(translated)
                    ctx.log(f"Translated into {lang}: {os.path.basename(translated)}")
            except (speech.SpeechCancelled, translator.TranslationCancelled):
                raise item_runner.ItemCancelled() from None
            except (speech.SpeechError, subtitle_translate.TranslateError) as e:
                raise item_runner.ItemFailed(str(e), result) from None
            return result

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
                generic_error="Speech-to-text failed.",
            )
        finally:
            speech.release_sessions()
            translator.release_sessions()

        results = []
        for item, o in zip(items, outcomes, strict=True):
            row = {"video_path": item["video_path"], **o.result}
            if o.error:
                row["error"] = o.error
                log(db, job_id, f"{os.path.basename(item['video_path'])}: {o.error}", "error")
            if o.status in ("done", "failed"):
                results.append(row)
        subtitle_translate.finish_job(
            db, job, outcomes, results, "Generate", {"items": items, "translate_to": translate_to}
        )
    except Exception as e:
        logger.exception("generate job %s crashed", job_id)
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()
