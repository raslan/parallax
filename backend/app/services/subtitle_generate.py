"""Generate an English subtitle from a video's audio with Whisper, offline (RAS-125).

A stopgap for a release that has no subtitle yet. The result is a machine-made
`<name>.en.mt.srt` (see `machine_subs`), so the scan still wants a real subtitle and replaces
this one when it appears. `generate_one` does one file (no DB, cancel-aware); `run_generate_job`
is the queue job: progress, cancel with "N/M done before cancel", and an optional chain that
translates the result into other installed languages.
"""

import json
import logging
import os
import shutil
import tempfile
import textwrap
import threading
from collections.abc import Callable

from app.config import SCRATCH_DIR
from app.database import DATA_DIR
from app.services import machine_subs, speech, srt_io, subtitle_translate, translate_packs

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
    """items: [{"video_path": str, "model": "whisper-small"}, ...], one after another.
    `translate_to`: languages to translate each generated subtitle into afterwards."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
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

        results: list[dict] = []
        completed = failed = 0
        cancelled = False
        total = len(items)
        steps = 1 + len(translate_to)  # generation, then one translation per language

        def cancel() -> bool:
            return should_cancel(job_id)

        try:
            for idx, item in enumerate(items):
                if cancel():
                    cancelled = True
                    break
                video = item["video_path"]
                name = os.path.basename(video)
                job.current_file = name
                db.commit()
                last = {"pct": -1.0}

                def on_progress(
                    frac: float, step: int = 0, idx: int = idx, last: dict = last
                ) -> None:
                    if frac - last["pct"] >= 2.0 or frac >= 100.0:
                        last["pct"] = frac
                        job.progress = (idx + (step + frac / 100) / steps) / total * 100
                        db.commit()

                result: dict = {"video_path": video}
                try:
                    model = translate_packs.get_pack(item["model"])
                    if model is None:
                        raise subtitle_translate.TranslateError("Unknown speech model.")
                    out = generate_one(video, model, LANGUAGE, cancel, on_progress)
                    result["output"] = out
                    log(db, job_id, f"Generated {name} → {os.path.basename(out)}")
                    for step, lang in enumerate(translate_to, 1):
                        last["pct"] = -1.0
                        translated = subtitle_translate.translate_one(
                            video,
                            lang,
                            cancel,
                            lambda f, step=step: on_progress(f, step),
                            source=out,
                        )
                        result.setdefault("translations", []).append(translated)
                        log(db, job_id, f"Translated into {lang}: {os.path.basename(translated)}")
                    completed += 1
                except (speech.SpeechCancelled, subtitle_translate.translator.TranslationCancelled):
                    cancelled = True
                    break
                except (speech.SpeechError, subtitle_translate.TranslateError) as e:
                    failed += 1
                    result["error"] = str(e)
                    log(db, job_id, f"{name}: {e}", "error")
                except Exception as e:  # a crash in the model costs one file, not the batch
                    logger.exception("generate %s failed", video)
                    failed += 1
                    result["error"] = "Speech-to-text failed."
                    log(db, job_id, f"{name}: {type(e).__name__}: {e}", "error")
                results.append(result)
                job.processed_files = completed + failed
                job.progress = (idx + 1) / total * 100
                db.commit()
        finally:
            speech.release_sessions()
            subtitle_translate.translator.release_sessions()

        job.settings = json.dumps(
            {"items": items, "translate_to": translate_to, "results": results}
        )
        job.current_file = None
        job.finished_at = now()
        if cancelled:
            job.status = JobStatus.CANCELLED
            job.current_file = f"{completed}/{total} done before cancel"
            log(db, job_id, f"Generate cancelled — {completed} done, {failed} failed")
        elif failed and not completed:
            job.status = JobStatus.FAILED
            job.error = subtitle_translate._failure_summary(failed, total, results)
        else:
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            if failed:
                job.error = subtitle_translate._failure_summary(failed, total, results)
        db.commit()
    except Exception as e:
        logger.exception("generate job %s crashed", job_id)
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()
