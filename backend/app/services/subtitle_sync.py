"""Automatic subtitle sync — alass (default) or ffsubsync.

Both tools re-time a subtitle file's cues against the video's own audio via
voice-activity detection (speech/silence timing), not speech content — so
this works regardless of subtitle language vs audio language.

alass is a static Rust binary with no releases since 2019 (v2.0.0) — it's a
finished tool, not one that needs update/channel machinery like yt-dlp.
It's fetched once into DATA_DIR on first use and never re-checked.
ffsubsync is a pip dependency (see requirements.txt), invoked via `-m` so it
resolves regardless of how the interpreter's script-install PATH is set up.
"""

import logging
import os
import subprocess
import sys
import urllib.request

from app.database import DATA_DIR
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel

logger = logging.getLogger(__name__)

_ALASS_BIN = os.path.join(DATA_DIR, "alass")
_ALASS_URL = "https://github.com/kaegi/alass/releases/download/v2.0.0/alass-linux64"


def _alass_bin() -> str | None:
    if os.path.isfile(_ALASS_BIN) and os.access(_ALASS_BIN, os.X_OK):
        return _ALASS_BIN
    import shutil

    return shutil.which("alass") or shutil.which("alass-cli")


def ensure_alass() -> None:
    """Download the alass binary into DATA_DIR if not already present."""
    if _alass_bin():
        return
    tmp = _ALASS_BIN + ".tmp"
    try:
        urllib.request.urlretrieve(_ALASS_URL, tmp)
        os.chmod(tmp, 0o755)
        os.replace(tmp, _ALASS_BIN)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _sync_tmp_path(sub_path: str) -> str:
    """Temp output path for a synced subtitle. Keeps the original extension —
    both alass and ffsubsync infer their output format from it and refuse to
    write a `.tmp` file ("seems to have a different format... does not
    perform conversions")."""
    stem, ext = os.path.splitext(sub_path)
    return f"{stem}.sync_tmp{ext}"


def _run_synced(cmd: list[str], label: str, tmp_out: str) -> None:
    """Run a sync engine, streaming its output live to this process's own
    stdout — same as `docker compose logs` already shows for every other job
    — instead of buffering it silently and only surfacing a line on failure.
    Also keeps the last few lines to put the real reason in the raised error,
    since alass reports failures on stdout *after* a long \\r-updated
    progress bar, not on stderr.

    ponytail: no hang watchdog — both tools finish in well under a minute on
    a normal file. Add one (e.g. downloader.py's select()-based stall
    watchdog) if a hung sync is ever observed tying up a job-queue slot.
    """
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    tail: list[str] = []
    for line in proc.stdout:
        print(f"[{label}] {line}", end="", flush=True)
        tail.append(line)
        if len(tail) > 20:
            tail.pop(0)
    returncode = proc.wait()
    if returncode != 0 or not os.path.exists(tmp_out):
        detail = "".join(tail).strip() or "(no output — see container logs)"
        raise RuntimeError(f"{label} exited {returncode}: {detail}")


def sync_alass(video_path: str, sub_path: str) -> bool:
    ensure_alass()
    bin_path = _alass_bin()
    if not bin_path:
        raise RuntimeError("alass binary not available")

    tmp_out = _sync_tmp_path(sub_path)
    try:
        _run_synced([bin_path, video_path, sub_path, tmp_out], "alass", tmp_out)
        os.replace(tmp_out, sub_path)
        return True
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)


def sync_ffsubsync(video_path: str, sub_path: str) -> bool:
    tmp_out = _sync_tmp_path(sub_path)
    try:
        _run_synced(
            [sys.executable, "-m", "ffsubsync", video_path, "-i", sub_path, "-o", tmp_out],
            "ffsubsync",
            tmp_out,
        )
        os.replace(tmp_out, sub_path)
        return True
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)


def sync_subtitle(video_path: str, sub_path: str, engine: str = "alass") -> bool:
    """Align sub_path's cues to video_path's audio in place. Returns whether it succeeded."""
    if engine == "ffsubsync":
        return sync_ffsubsync(video_path, sub_path)
    return sync_alass(video_path, sub_path)


def run_sync_job(job_id: int, video_path: str, sub_paths: list[str], engine: str) -> None:
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(sub_paths)
        db.commit()
        arm_cancel(job_id)

        synced = failed = 0
        was_cancelled = False
        for i, sub_path in enumerate(sub_paths):
            if should_cancel(job_id):
                was_cancelled = True
                break

            fname = os.path.basename(sub_path)
            job.current_file = fname
            job.processed_files = i
            job.progress = (i / len(sub_paths)) * 99
            db.commit()

            try:
                sync_subtitle(video_path, sub_path, engine)
                synced += 1
                log(db, job_id, f"Synced: {fname}")
            except Exception as exc:
                failed += 1
                log(db, job_id, f"Sync failed: {fname} — {exc}", level="error")

        clear_cancel(job_id)
        job.processed_files = len(sub_paths)
        job.finished_at = now()
        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.current_file = f"Cancelled — {synced} synced, {failed} failed"
        else:
            job.progress = 100.0
            job.status = JobStatus.COMPLETED
            job.current_file = f"{synced} synced, {failed} failed"
        db.commit()

    except Exception as exc:
        logger.exception("Subtitle sync job %d failed", job_id)
        try:
            job = db.get(Job, job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job.finished_at = now()
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
