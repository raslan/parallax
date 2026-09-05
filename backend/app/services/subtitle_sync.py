"""Subtitle sync — alass (default) or ffsubsync, both VAD-based (timing only,
language-agnostic). alass is a static binary with no releases since 2019, so
it's just fetched once into DATA_DIR, no update/channel machinery."""

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
    # keep the real extension — both tools infer output format from it and
    # refuse to write a plain .tmp file
    stem, ext = os.path.splitext(sub_path)
    return f"{stem}.sync_tmp{ext}"


def _run_synced(cmd: list[str], label: str, tmp_out: str) -> None:
    # stream to our own stdout (visible via `docker compose logs`) instead of
    # buffering silently; also keep a tail for the raised error's detail
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
    if engine == "ffsubsync":
        return sync_ffsubsync(video_path, sub_path)
    return sync_alass(video_path, sub_path)


def collect_sync_targets(path: str) -> list[tuple[str, str]]:
    from app.services.subtitle_service import VIDEO_EXTENSIONS, find_all_subtitle_tracks

    targets: list[tuple[str, str]] = []
    for dirpath, _, filenames in os.walk(path):
        for fname in sorted(filenames):
            if os.path.splitext(fname)[1].lower() not in VIDEO_EXTENSIONS:
                continue
            video_path = os.path.join(dirpath, fname)
            for track in find_all_subtitle_tracks(video_path):
                targets.append((video_path, track["path"]))
    return targets


def run_sync_job(job_id: int, targets: list[tuple[str, str]], engine: str) -> None:
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(targets)
        db.commit()
        arm_cancel(job_id)

        synced = failed = 0
        was_cancelled = False
        for i, (video_path, sub_path) in enumerate(targets):
            if should_cancel(job_id):
                was_cancelled = True
                break

            fname = os.path.basename(sub_path)
            job.current_file = fname
            job.processed_files = i
            job.progress = (i / len(targets)) * 99
            db.commit()

            try:
                sync_subtitle(video_path, sub_path, engine)
                synced += 1
                log(db, job_id, f"Synced: {fname}")
            except Exception as exc:
                failed += 1
                log(db, job_id, f"Sync failed: {fname} — {exc}", level="error")

        clear_cancel(job_id)
        job.processed_files = len(targets)
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
