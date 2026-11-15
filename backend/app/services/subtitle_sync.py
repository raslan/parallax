"""Subtitle sync — alass (default) or ffsubsync, both VAD-based (timing only,
language-agnostic). alass is a static binary with no releases since 2019, so
it's just fetched once into DATA_DIR, no update/channel machinery."""

import logging
import os
import shutil
import subprocess
import sys
import urllib.request

from app.database import DATA_DIR
from app.services import file_props, subtitle_files, subtitle_names
from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel

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
        _swap_in(tmp_out, sub_path)
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
        _swap_in(tmp_out, sub_path)
        return True
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)


def _swap_in(tmp_out: str, sub_path: str) -> None:
    """Put the synced temp file over the subtitle. Takes the write lock subtitle_files uses, so
    a rename or make-main cannot interleave with the swap; the minutes-long engine run itself
    holds no lock (it only reads the subtitle and writes its own temp file)."""
    with subtitle_files._WRITE_LOCK:
        if not os.path.exists(sub_path):
            raise RuntimeError("The subtitle was renamed or deleted while it was syncing.")
        file_props.copy_props(sub_path, tmp_out)
        os.replace(tmp_out, sub_path)


def ensure_original(sub_path: str) -> str | None:
    """Keep the file as `<name>.original.srt` before a sync changes it, but only if no backup
    exists yet (the first sync's backup is the true original). Returns the backup path, or None
    when one already existed. Temp copy + `os.replace` under the write lock: two racing syncs
    cannot lose the first backup or leave a half-written one. Raises OSError on failure."""
    backup = subtitle_names.original_path(sub_path)
    with subtitle_files._WRITE_LOCK:
        if os.path.exists(backup):
            return None
        tmp = backup + ".tmp"
        try:
            shutil.copyfile(sub_path, tmp)
            file_props.copy_props(sub_path, tmp)
            os.replace(tmp, backup)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    return backup


def restore_original(video_path: str, sub_path: str) -> bool:
    """Swap the `.original` backup back over the subtitle (the backup is consumed). Both paths
    must be the video's own subtitle files; refused otherwise."""
    with subtitle_files._WRITE_LOCK:
        (entry,) = subtitle_files._owned(video_path, [sub_path])
        if entry["kind"] == "original":
            raise subtitle_files.SubtitleFileError("That file is already a backup.")
        backup = subtitle_names.original_path(entry["path"])
        if not os.path.isfile(backup):
            raise subtitle_files.SubtitleNotFound("There is no original to restore.")
        (backup_entry,) = subtitle_files._owned(video_path, [backup])
        try:
            os.replace(backup_entry["path"], entry["path"])
        except OSError as e:
            raise subtitle_files.SubtitleFileError(
                f"Could not restore the original: {e.strerror or e}"
            ) from e
    return True


def sync_subtitle(video_path: str, sub_path: str, engine: str = "alass") -> bool:
    ensure_original(sub_path)  # a failed backup aborts the sync; the subtitle is untouched
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
            db.rollback()  # a failed flush poisons the session; get() below needs it usable
            fail_job(db, db.get(Job, job_id), exc)
        except Exception:
            logger.exception("Could not mark subtitle sync job %d failed", job_id)
    finally:
        db.close()


# ---------------------------------------------------------------- many videos, one job


def _update_job(job_id: int, **fields) -> None:
    """One short-lived session per write: none is held across a sync."""
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
    """A job log line in its own short-lived session, like `_update_job`."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        log(db, job_id, message, level)
    finally:
        db.close()


def _sync_video(job_id: int, video_path: str, engine: str) -> dict:
    """Every subtitle of one video (real, generated and translated; never a `.original`
    backup), the same set the folder sync covers. A failing subtitle costs only itself.
    Every subtitle gets a job log line ("Synced: …" / "Sync failed: … — reason", the old
    runner's wording); the result keeps every failure in `errors` and the first bare reason
    in `error`. A video with no subtitle at all is `skipped`."""
    from app.services.subtitle_service import find_all_subtitle_tracks

    tracks = find_all_subtitle_tracks(video_path)
    if not tracks:
        _log_job(job_id, f"Skipped: {os.path.basename(video_path)} — no subtitle")
        return {"video_path": video_path, "status": "skipped", "reason": "no subtitle"}

    synced = 0
    reasons: list[str] = []
    errors: list[str] = []
    for track in tracks:
        name = os.path.basename(track["path"])
        try:
            ok = sync_subtitle(video_path, track["path"], engine)
            reason = None if ok else "the sync engine gave up"
        except Exception as exc:
            reason = str(exc) or type(exc).__name__
        if reason is None:
            synced += 1
            _log_job(job_id, f"Synced: {name}")
        else:
            reasons.append(reason)
            errors.append(f"{name}: {reason}")
            _log_job(job_id, f"Sync failed: {name} — {reason}", level="error")
    result: dict = {"video_path": video_path, "synced": synced, "failed": len(errors)}
    if errors:
        result["error"] = reasons[0]
        result["errors"] = errors
    result["status"] = "failed" if errors and not synced else "synced"
    return result


def run_sync_files_job(job_id: int, video_paths: list[str], engine: str) -> None:
    """Sync the subtitles of the chosen videos, one video after another. Per-video results go
    into `job.settings["results"]`; a cancel stops between videos; a video that fails costs
    only itself, and every video failing fails the job with the first reason."""
    import json

    from app.database import SessionLocal
    from app.models.job import Job, JobStatus

    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None or job.status == JobStatus.CANCELLED:
                return  # cancelled while it waited for a queue slot
            job.status = JobStatus.RUNNING
            job.started_at = now()
            job.total_files = len(video_paths)
            db.commit()
            try:
                stored = json.loads(job.settings or "{}")
            except ValueError:
                stored = {}
        finally:
            db.close()
        arm_cancel(job_id)

        total = len(video_paths)
        results: list[dict] = []
        cancelled = False
        for i, video_path in enumerate(video_paths):
            if should_cancel(job_id):
                cancelled = True
                break
            _update_job(
                job_id,
                current_file=os.path.basename(video_path),
                processed_files=i,
                progress=i / total * 99,
            )
            results.append(_sync_video(job_id, video_path, engine))
            _update_job(
                job_id,
                processed_files=i + 1,
                settings=json.dumps({**stored, "results": results}),
            )

        synced = sum(r["status"] == "synced" for r in results)
        failed = sum(r["status"] == "failed" for r in results)
        skipped = sum(r["status"] == "skipped" for r in results)
        done = len(results)
        fields: dict = {"finished_at": now(), "processed_files": done}
        if cancelled:
            results += [
                {"video_path": p, "status": "skipped", "reason": "cancelled"}
                for p in video_paths[done:]
            ]
            fields.update(
                status=JobStatus.CANCELLED, current_file=f"{done} of {total} done before cancel"
            )
        elif failed and not synced:
            first = next(r["error"] for r in results if r.get("error"))
            fields.update(status=JobStatus.FAILED, error=first[:512], current_file=None)
        else:
            parts = [f"{synced} synced"]
            if failed:
                parts.append(f"{failed} failed")
            if skipped:
                parts.append(f"{skipped} skipped")
            fields.update(status=JobStatus.COMPLETED, progress=100.0, current_file=", ".join(parts))
        fields["settings"] = json.dumps({**stored, "results": results})
        _update_job(job_id, **fields)
    except Exception as exc:
        logger.exception("Subtitle sync job %d failed", job_id)
        db = SessionLocal()
        try:
            fail_job(db, db.get(Job, job_id), exc)
        except Exception:
            logger.exception("Could not mark subtitle sync job %d failed", job_id)
        finally:
            db.close()
    finally:
        clear_cancel(job_id)
