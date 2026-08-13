import os
import re
import subprocess


def _build_toolbox_cmd(
    input_path: str,
    output_path: str,
    duration: float,
    trim_start: float,
    trim_end: float,
    audio_channel: str | None,   # "left" | "right" | None — already resolved, "auto" is resolved upstream
    rotate_deg: int | None,      # 90 | 180 | 270 | None
    normalize: bool,
    faststart: bool,
    sync_offset_ms: float | None,
) -> list[str]:
    needs_video_reencode = rotate_deg is not None
    needs_audio_reencode = audio_channel is not None or normalize or sync_offset_ms is not None
    has_dual_input = sync_offset_ms is not None

    ss_args = ["-ss", str(trim_start)] if trim_start > 0 else []

    cmd = ["ffmpeg", "-y", *ss_args, "-i", input_path]

    if has_dual_input:
        cmd += [*ss_args, "-itsoffset", str(sync_offset_ms / 1000), "-i", input_path]
        cmd += ["-map", "0:v", "-map", "1:a?"]
    else:
        cmd += ["-map", "0:v", "-map", "0:a?"]

    if trim_start > 0 or trim_end > 0:
        clip_len = duration - trim_start - trim_end
        cmd += ["-t", str(clip_len)]

    vf_filters = []
    if rotate_deg == 90:
        vf_filters.append("transpose=1")
    elif rotate_deg == 270:
        vf_filters.append("transpose=2")
    elif rotate_deg == 180:
        vf_filters.append("transpose=1,transpose=1")
    if vf_filters:
        cmd += ["-vf", ",".join(vf_filters)]

    cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "medium"] if needs_video_reencode else ["-c:v", "copy"]

    af_filters = []
    if audio_channel == "left":
        af_filters.append("pan=stereo|c0=c0|c1=c0")
    elif audio_channel == "right":
        af_filters.append("pan=stereo|c0=c1|c1=c1")
    if normalize:
        af_filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    if af_filters:
        cmd += ["-af", ",".join(af_filters)]

    cmd += ["-c:a", "aac", "-b:a", "192k"] if needs_audio_reencode else ["-c:a", "copy"]

    out_ext = os.path.splitext(output_path)[1].lower()
    if faststart and out_ext in {".mp4", ".m4v", ".mov"}:
        cmd += ["-movflags", "+faststart"]

    cmd += ["-progress", "pipe:1", "-nostats", output_path]
    return cmd


_CHANNEL_BLOCK_RE = re.compile(r"Channel:\s*(\d+)\s*.*?RMS level dB:\s*(-?[\d.]+|-inf)", re.S)


def parse_channel_rms(astats_output: str) -> dict[int, float]:
    """Parse ffmpeg `-filter:a astats` stderr text into {channel_number: rms_db}."""
    result: dict[int, float] = {}
    for chan_str, rms_str in _CHANNEL_BLOCK_RE.findall(astats_output):
        result[int(chan_str)] = float("-inf") if rms_str == "-inf" else float(rms_str)
    return result


def detect_louder_channel(path: str) -> str:
    """Run ffmpeg astats on the file's audio, return 'left' or 'right' — whichever channel has higher RMS."""
    proc = subprocess.run(
        ["ffmpeg", "-i", path, "-filter:a", "astats", "-f", "null", "-"],
        capture_output=True, text=True, timeout=60,
    )
    rms = parse_channel_rms(proc.stderr)
    left_db = rms.get(1, float("-inf"))
    right_db = rms.get(2, float("-inf"))
    return "left" if left_db >= right_db else "right"


import concurrent.futures as _cf
import queue as _queue
import shutil
import tempfile
import threading
from typing import Callable

from app.database import SessionLocal
from app.models.job import Job, JobStatus
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel
from app.services.compressor import _cleanup, _read_and_remove


def _resolve_audio_channel(path: str, audio_channel: str | None) -> str | None:
    if audio_channel == "auto":
        return detect_louder_channel(path)
    return audio_channel


def _toolbox_fix_one(
    file_path: str,
    settings: dict,
    job_id: int,
    progress_cb: Callable[[float], None] | None = None,
    keep_original: bool = True,
) -> tuple[bool, str | None]:
    """Apply the configured fix(es) to one file in-place. Returns (success, error_msg)."""
    if should_cancel(job_id):
        return False, "Cancelled"
    src = file_path
    base, ext = os.path.splitext(src)
    tmp = base + ".fixing" + ext
    dst = src

    duration = 0.0
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-print_format", "csv=p=0", src],
            capture_output=True, text=True, timeout=30,
        )
        if probe.stdout.strip():
            duration = float(probe.stdout.strip().split("\n")[0])
    except Exception:
        pass

    trim_start = settings.get("trim_start") or 0
    trim_end = settings.get("trim_end") or 0

    if (trim_start > 0 or trim_end > 0) and (duration <= 0 or duration - trim_start - trim_end < 1.0):
        return False, "Could not determine file duration or trim exceeds duration"

    try:
        audio_channel = _resolve_audio_channel(src, settings.get("audio_channel"))
    except Exception:
        audio_channel = None

    cmd = _build_toolbox_cmd(
        src, tmp, duration,
        trim_start=trim_start,
        trim_end=trim_end,
        audio_channel=audio_channel,
        rotate_deg=settings.get("rotate_deg"),
        normalize=settings.get("normalize", False),
        faststart=settings.get("faststart", False),
        sync_offset_ms=settings.get("sync_offset_ms"),
    )

    proc = None
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="toolbox_")
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err_fd, text=True)
        os.close(err_fd)
        err_fd = -1

        for line in iter(proc.stdout.readline, ""):
            if should_cancel(job_id):
                proc.kill()
                proc.wait()
                _cleanup(tmp)
                _cleanup(err_path)
                return False, "Cancelled"

            line = line.strip()
            if line.startswith("out_time_ms=") and duration > 0 and progress_cb:
                try:
                    ms = int(line.split("=")[1])
                    if ms > 0:
                        progress_cb(min(ms / 1_000_000 / duration, 0.99))
                except (ValueError, IndexError):
                    pass

        proc.wait()

        if proc.returncode != 0:
            stderr_text = _read_and_remove(err_path)
            _cleanup(tmp)
            return False, (stderr_text[-512:] if stderr_text else f"ffmpeg exit {proc.returncode}")

        _cleanup(err_path)

        if keep_original:
            originals_dir = os.path.join(os.path.dirname(src), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            shutil.move(src, os.path.join(originals_dir, os.path.basename(src)))
        else:
            os.remove(src)

        shutil.move(tmp, dst)
        return True, None

    except Exception as e:
        if err_fd != -1:
            try:
                os.close(err_fd)
            except OSError:
                pass
        if proc:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass
        _cleanup(tmp)
        _cleanup(err_path)
        return False, str(e)


def run_toolbox_job(
    job_id: int,
    video_paths: list[str],
    settings: dict,
    keep_original: bool = True,
) -> None:
    from app.models.settings import get_setting

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(video_paths)
        db.commit()

        total = len(video_paths)
        n_concurrent = max(1, int(get_setting(db, "max_concurrent_transcodes", "1")))

        fracs: dict[str, float] = {}
        fracs_lock = threading.Lock()
        log_q: _queue.SimpleQueue = _queue.SimpleQueue()
        completed = 0
        failed = 0
        was_cancelled = False

        arm_cancel(job_id)

        def make_progress_cb(path: str) -> Callable[[float], None]:
            def cb(frac: float) -> None:
                with fracs_lock:
                    fracs[path] = frac
            return cb

        def do_one(path: str) -> tuple[str, bool, str | None]:
            fname = os.path.basename(path)
            log_q.put(("info", f"Fixing: {fname}"))
            ok, err = _toolbox_fix_one(
                path, settings, job_id,
                progress_cb=make_progress_cb(path),
                keep_original=keep_original,
            )
            with fracs_lock:
                fracs.pop(path, None)
            return path, ok, err

        def flush_to_db() -> None:
            while not log_q.empty():
                try:
                    level, msg = log_q.get_nowait()
                    log(db, job_id, msg, level)
                except _queue.Empty:
                    break
            with fracs_lock:
                in_flight = sum(fracs.values())
                active_names = [os.path.basename(p) for p in fracs.keys()]
            pct = (completed + in_flight) / total * 100 if total else 100.0
            job.progress = min(pct, 99.0)
            job.processed_files = completed
            job.current_file = " · ".join(active_names) if active_names else None
            db.commit()

        with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
            future_map = {pool.submit(do_one, path): path for path in video_paths}
            pending = set(future_map)

            while pending:
                done, pending = _cf.wait(pending, timeout=2.0)

                if should_cancel(job_id):
                    was_cancelled = True
                    for f in pending:
                        f.cancel()
                    _cf.wait(pending)
                    pending = set()

                for fut in done:
                    try:
                        path, ok, err = fut.result()
                    except _cf.CancelledError:
                        continue
                    fname = os.path.basename(path)
                    if ok:
                        completed += 1
                        log_q.put(("info", f"Done: {fname}"))
                    elif err != "Cancelled":
                        failed += 1
                        log_q.put(("error", f"Failed: {fname} — {err}"))

                flush_to_db()

        clear_cancel(job_id)

        while not log_q.empty():
            try:
                level, msg = log_q.get_nowait()
                log(db, job_id, msg, level)
            except _queue.Empty:
                break

        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            job.current_file = f"{completed}/{total} done before cancel"
            db.commit()
            log(db, job_id, f"Toolbox fix cancelled — {completed} done, {failed} failed")
            return

        if failed > 0:
            job.error = f"{failed} of {total} file(s) failed"
        job.status = JobStatus.FAILED if (failed > 0 and completed == 0) else JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = f"{completed}/{total} fixed"
        db.commit()
        log(db, job_id, f"Toolbox fix complete — {completed} succeeded, {failed} failed")

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
