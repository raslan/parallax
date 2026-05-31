import os
import shutil
import subprocess
import tempfile
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

_av1_encoder: str | None = None
_av1_checked = False


def _get_av1_encoder() -> str | None:
    global _av1_encoder, _av1_checked
    if _av1_checked:
        return _av1_encoder
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        stdout = result.stdout
        if "libsvtav1" in stdout:
            _av1_encoder = "libsvtav1"
        elif "libaom-av1" in stdout:
            _av1_encoder = "libaom-av1"
    except Exception:
        pass
    _av1_checked = True
    return _av1_encoder


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
    db,
    progress_cb: Callable[[float], None] | None = None,
    keep_original: bool = True,
) -> tuple[bool, str | None]:
    """Compress one file in-place. Returns (success, error_msg)."""
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

        last_commit = time.monotonic()
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
                        t = time.monotonic()
                        if t - last_commit >= 2.0:
                            db.commit()
                            last_commit = t
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
        succeeded = 0
        failed = 0

        arm_cancel(job_id)

        for i, file_path in enumerate(video_paths):
            if should_cancel(job_id):
                job.status = JobStatus.CANCELLED
                job.finished_at = now()
                db.commit()
                log(db, job_id, "Compress cancelled")
                clear_cancel(job_id)
                return

            fname = os.path.basename(file_path)
            job.current_file = fname
            job.progress = max(5.0, (i / total) * 100) if total > 1 else 5.0
            db.commit()
            log(db, job_id, f"[{i + 1}/{total}] Compressing: {fname}")

            def make_cb(idx: int, tot: int) -> Callable[[float], None]:
                def cb(frac: float) -> None:
                    job.progress = (idx + frac) / tot * 100
                return cb

            ok, err = _compress_one(
                file_path, codec, crf, speed, job_id, db,
                progress_cb=make_cb(i, total),
                keep_original=keep_original,
            )

            if ok:
                succeeded += 1
                log(db, job_id, f"Done: {fname}")
            elif not should_cancel(job_id):
                failed += 1
                log(db, job_id, f"Failed: {fname} — {err}", level="error")

            job.processed_files = i + 1
            job.progress = ((i + 1) / total) * 100
            db.commit()

        clear_cancel(job_id)

        if failed > 0:
            job.error = f"{failed} of {total} file(s) failed"
        job.status = (
            JobStatus.FAILED if (failed > 0 and succeeded == 0) else JobStatus.COMPLETED
        )
        job.progress = 100.0
        job.finished_at = now()
        job.current_file = f"{succeeded}/{total} compressed"
        db.commit()
        log(db, job_id, f"Compress complete — {succeeded} succeeded, {failed} failed")

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        db.close()
