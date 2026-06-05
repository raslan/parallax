import concurrent.futures as _cf
import os
import queue as _queue
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Callable

from app.database import SessionLocal
from app.models.job import Job, JobStatus, JobType
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel
from app.services.encoder import _get_encoders

_SOURCE_EFFICIENCY: dict[str, float] = {
    "h264": 1.0,
    "hevc": 0.55,
    "av1": 0.45,
    "vp9": 0.55,
    "vp8": 0.85,
    "mpeg2video": 1.5,
    "mpeg4": 1.2,
    "wmv2": 1.4,
    "wmv3": 1.2,
    "msmpeg4v3": 1.3,
    "flv1": 1.3,
}

_TARGET_EFFICIENCY: dict[str, float] = {
    "h264": 1.0,
    "hevc": 0.55,
    "av1": 0.45,
}

_DEFAULT_CRF: dict[str, int] = {
    "h264": 23,
    "hevc": 28,
    "av1": 35,
}

_NEEDS_REMUX = {".webm", ".flv", ".avi", ".wmv"}

def _get_av1_encoder() -> str | None:
    enc = _get_encoders().get("av1", "libsvtav1")
    return enc if enc else None


def get_available_codecs() -> list[dict]:
    encoders = _get_encoders()
    codecs = [
        {
            "id": "h264",
            "label": "H.264",
            "encoder": encoders["h264"],
            "default_crf": 23,
            "crf_min": 0,
            "crf_max": 51,
            "description": "Widest compatibility, moderate compression",
        },
        {
            "id": "hevc",
            "label": "HEVC (H.265)",
            "encoder": encoders["hevc"],
            "default_crf": 28,
            "crf_min": 0,
            "crf_max": 51,
            "description": "~40-50% smaller than H.264 at same quality",
        },
    ]
    av1 = _get_av1_encoder()
    if av1:
        codecs.append({
            "id": "av1",
            "label": "AV1",
            "encoder": av1,
            "default_crf": 35,
            "crf_min": 0,
            "crf_max": 63,
            "description": "~50-60% smaller than H.264, slower to encode",
        })
    return codecs


def estimate_size(
    source_size: int,
    source_codec: str | None,
    target_codec: str,
    crf: int,
) -> int:
    """Estimate compressed size in bytes. Approximate: ±20% of actual result."""
    if not source_size:
        return 0
    src_eff = _SOURCE_EFFICIENCY.get((source_codec or "h264").lower(), 1.0)
    tgt_eff = _TARGET_EFFICIENCY.get(target_codec, 1.0)
    default_crf = _DEFAULT_CRF.get(target_codec, 23)
    crf_delta = crf - default_crf
    crf_factor = 2 ** (-crf_delta / 6)
    factor = max((tgt_eff / src_eff) * crf_factor, 0.05)
    return int(source_size * factor)



def _build_compress_cmd(
    input_path: str,
    output_path: str,
    codec: str,
    crf: int,
    speed: str,
    reencode_audio: bool = False,
) -> list[str]:
    encoders = _get_encoders()

    if codec == "h264":
        encoder = encoders["h264"]
    elif codec == "hevc":
        encoder = encoders["hevc"]
    else:
        encoder = _get_av1_encoder() or "libsvtav1"

    nvenc = encoder in ("h264_nvenc", "hevc_nvenc")
    is_hevc = codec == "hevc"

    if nvenc:
        nvenc_preset = {"slow": "p7", "medium": "p5", "fast": "p3"}.get(speed, "p5")
        video_args = ["-c:v", encoder, "-rc:v", "vbr", "-cq:v", str(crf), "-preset", nvenc_preset]
    elif encoder == "libsvtav1":
        svt_preset = {"slow": "4", "medium": "8", "fast": "10"}.get(speed, "8")
        video_args = ["-c:v", encoder, "-crf", str(crf), "-preset", svt_preset]
    elif encoder == "libaom-av1":
        video_args = ["-c:v", encoder, "-crf", str(crf), "-b:v", "0", "-cpu-used", "4"]
    else:
        video_args = ["-c:v", encoder, "-crf", str(crf), "-preset", speed]

    # MP4/M4V/MOV containers require the hvc1 tag to signal HEVC; without it
    # the muxer rejects the stream ("codec not currently supported in container").
    out_ext = os.path.splitext(output_path)[1].lower()
    tag_args = ["-tag:v", "hvc1"] if is_hevc and out_ext in {".mp4", ".m4v", ".mov"} else []

    audio_args = ["-c:a", "aac", "-b:a", "192k"] if reencode_audio else ["-c:a", "copy"]

    return [
        "ffmpeg", "-y",
        "-i", input_path,
        *video_args,
        *tag_args,
        *audio_args,
        "-progress", "pipe:1",
        "-nostats",
        output_path,
    ]


def _compress_one(
    file_path: str,
    codec: str,
    crf: int,
    speed: str,
    job_id: int,
    progress_cb: Callable[[float], None] | None = None,
    keep_original: bool = True,
) -> tuple[bool, str | None]:
    """Compress one file in-place. Returns (success, error_msg)."""
    if should_cancel(job_id):
        return False, "Cancelled"
    src = file_path
    base, ext = os.path.splitext(src)
    # .m4v uses the restrictive ipod muxer which rejects HEVC/AV1 regardless of tags.
    # Force to .mp4 (standard mp4 muxer) so -tag:v hvc1 can do its job.
    _IPOD_EXTS = {".m4v"}
    if codec in ("hevc", "av1") and ext.lower() in _IPOD_EXTS:
        out_ext = ".mp4"
        changing_container = True
    elif ext.lower() in _NEEDS_REMUX:
        out_ext = ".mkv"
        changing_container = True
    else:
        out_ext = ext.lower() or ".mkv"
        changing_container = False
    tmp = base + ".compressing" + out_ext
    dst = src if out_ext == ext.lower() else (base + out_ext)

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

    proc = None
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="compress_")
    try:
        proc = subprocess.Popen(
            _build_compress_cmd(src, tmp, codec, crf, speed, reencode_audio=changing_container),
            stdout=subprocess.PIPE,
            stderr=err_fd,
            text=True,
        )
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


def _cleanup(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _read_and_remove(path: str) -> str:
    try:
        with open(path) as f:
            text = f.read()
        os.remove(path)
        return text
    except OSError:
        return ""


def run_compress_job(
    job_id: int,
    video_paths: list[str],
    codec: str,
    crf: int,
    speed: str,
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

        # Shared state — accessed from worker threads under lock
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
            log_q.put(("info", f"Compressing: {fname}"))
            ok, err = _compress_one(
                path, codec, crf, speed, job_id,
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
                    # Cancel futures that haven't started yet
                    for f in pending:
                        f.cancel()
                    # Wait for already-running futures (they kill their ffmpeg process)
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

        # Drain any remaining log messages
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
            log(db, job_id, f"Compress cancelled — {completed} done, {failed} failed")
            return

        if failed > 0:
            job.error = f"{failed} of {total} file(s) failed"
        job.status = JobStatus.FAILED if (failed > 0 and completed == 0) else JobStatus.COMPLETED
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = f"{completed}/{total} compressed"
        db.commit()
        log(db, job_id, f"Compress complete — {completed} succeeded, {failed} failed")

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
