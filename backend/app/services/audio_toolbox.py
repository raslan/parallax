"""Audio Toolbox: fix one or more audio files with a stackable set of
operations — trim, channel fix, two-pass EBU R128 loudness normalisation.

Structurally mirrors `services/toolbox.py` (the video Toolbox job runner) with
every video concern removed. Pure command builders live at the top and are
unit-tested without touching ffmpeg or the DB.
"""

import concurrent.futures as _cf
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable

from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus
from app.models.settings import get_setting
from app.services import audio_scanner
from app.services.audio_compressor import _has_encoder
from app.services.common import (
    arm_cancel,
    clear_cancel,
    now,
    should_cancel,
    temp_sibling_path,
)

logger = logging.getLogger(__name__)

LOUDNORM_TARGET = "I=-16:TP=-1.5:LRA=11"
CHANNEL_OPS = ("mono", "downmix_stereo", "left_to_both", "right_to_both")

# lossy source codec -> (preferred encoder, fallback encoder, fallback bitrate
# when the source bitrate is unknown). Lossless codecs are handled separately.
_LOSSY_ENCODERS: dict[str, tuple[str, str, str]] = {
    "aac": ("libfdk_aac", "aac", "192k"),
    "mp3": ("libmp3lame", "libmp3lame", "192k"),
    "opus": ("libopus", "libopus", "128k"),
    "vorbis": ("libvorbis", "libvorbis", "160k"),
}
_LOSSLESS_ENCODERS: dict[str, str] = {
    "flac": "flac",
    "alac": "alac",
}
_DEFAULT_LOSSY = ("libfdk_aac", "aac", "192k")


def _encoder_for_source(codec_name: str | None, bitrate_bps: int | None) -> tuple[str, str | None]:
    """Resolve (encoder, bitrate_arg) for re-encoding a file back into its own
    codec family. bitrate_arg is None for lossless targets."""
    codec = (codec_name or "").lower()

    if codec.startswith("pcm_"):
        return "pcm_s16le", None
    if codec in _LOSSLESS_ENCODERS:
        return _LOSSLESS_ENCODERS[codec], None

    preferred, fallback, fallback_bitrate = _LOSSY_ENCODERS.get(codec, _DEFAULT_LOSSY)
    encoder = preferred if _has_encoder(preferred) else fallback

    if bitrate_bps and bitrate_bps > 0:
        bitrate_arg = f"{round(bitrate_bps / 1000)}k"
    else:
        bitrate_arg = fallback_bitrate
    return encoder, bitrate_arg


def _parse_loudnorm_json(stderr_text: str) -> dict | None:
    """Pull the trailing JSON object ffmpeg's loudnorm prints with
    print_format=json. Scans from the last '{' that yields valid JSON."""
    starts = [m.start() for m in re.finditer(r"\{", stderr_text)]
    for start in reversed(starts):
        chunk = stderr_text[start:]
        end = chunk.rfind("}")
        while end != -1:
            try:
                data = json.loads(chunk[: end + 1])
            except ValueError:
                end = chunk.rfind("}", 0, end)
                continue
            if "input_i" in data:
                return {
                    "input_i": str(data["input_i"]),
                    "input_tp": str(data["input_tp"]),
                    "input_lra": str(data["input_lra"]),
                    "input_thresh": str(data["input_thresh"]),
                    "target_offset": str(data.get("target_offset", "0.0")),
                }
            end = chunk.rfind("}", 0, end)
    return None


def _loudnorm_filter(measured: dict | None) -> str:
    if not measured:
        return f"loudnorm={LOUDNORM_TARGET}"
    return (
        f"loudnorm={LOUDNORM_TARGET}"
        f":measured_I={measured['input_i']}"
        f":measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}"
        f":measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}"
        f":linear=true"
    )


def _build_audio_toolbox_cmd(
    src: str,
    out: str,
    *,
    duration: float,
    trim_start: float,
    trim_end: float,
    channel_op: str | None,
    normalize: bool,
    encoder: str,
    bitrate_arg: str | None,
    measured: dict | None,
) -> list[str]:
    reencode = normalize or channel_op is not None

    cmd: list[str] = ["ffmpeg", "-y"]
    if trim_start > 0:
        cmd += ["-ss", str(trim_start)]
    cmd += ["-i", src]

    if trim_start > 0 or trim_end > 0:
        clip_len = duration - trim_start - trim_end
        cmd += ["-t", str(clip_len)]

    cmd += ["-map", "0:a:0", "-map_metadata", "0", "-map_metadata:s:a", "0", "-map_chapters", "0"]

    af: list[str] = []
    if channel_op == "left_to_both":
        af.append("pan=stereo|c0=c0|c1=c0")
    elif channel_op == "right_to_both":
        af.append("pan=stereo|c0=c1|c1=c1")
    if normalize:
        af.append(_loudnorm_filter(measured))
    if af:
        cmd += ["-af", ",".join(af)]

    if channel_op == "mono":
        cmd += ["-ac", "1"]
    elif channel_op == "downmix_stereo":
        cmd += ["-ac", "2"]

    if reencode:
        cmd += ["-c:a", encoder]
        if bitrate_arg:
            cmd += ["-b:a", bitrate_arg]
    else:
        cmd += ["-c:a", "copy"]

    cmd += ["-progress", "pipe:1", "-nostats", out]
    return cmd


# ---- runtime: loudnorm measure + per-file fix + job runner -------------------


def _measure_loudnorm(path: str) -> dict | None:
    """First loudnorm pass — analysis only. Returns the measured dict or None."""
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-nostats",
                "-i",
                path,
                "-af",
                f"loudnorm={LOUDNORM_TARGET}:print_format=json",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode != 0:
        logger.warning(
            "loudnorm measure pass failed (ffmpeg exit %s) for %s — falling back to dynamic pass",
            proc.returncode,
            path,
        )
        return None
    return _parse_loudnorm_json(proc.stderr or "")


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _row_id_for(src: str) -> int:
    db = SessionLocal()
    try:
        row = db.query(AudioFile).filter(AudioFile.path == src).first()
        return row.id if row else 0
    finally:
        db.close()


def _toolbox_fix_one(
    src: str,
    settings: dict,
    keep_original: bool,
    job_id: int,
    progress_cb: Callable[[float], None] | None = None,
) -> tuple[bool, str | None]:
    """Apply the toolbox ops to one audio file in place. Returns (ok, error)."""
    if should_cancel(job_id):
        return False, "Cancelled"
    if not os.path.isfile(src):
        return False, "Source file missing"

    db = SessionLocal()
    try:
        row = db.query(AudioFile).filter(AudioFile.path == src).first()
        codec_name = row.codec_name if row else None
        bitrate_bps = row.bitrate if row else None
        duration = float(row.duration or 0.0) if row else 0.0
    finally:
        db.close()

    channel_op = settings.get("channel_op")
    normalize = bool(settings.get("normalize"))
    trim_start = float(settings.get("trim_start") or 0.0)
    trim_end = float(settings.get("trim_end") or 0.0)

    encoder, bitrate_arg = _encoder_for_source(codec_name, bitrate_bps)
    measured = _measure_loudnorm(src) if normalize else None

    ext = os.path.splitext(src)[1]
    tmp = temp_sibling_path(src, ext, "compressing")  # watcher skips `.compressing*`
    cmd = _build_audio_toolbox_cmd(
        src,
        tmp,
        duration=duration,
        trim_start=trim_start,
        trim_end=trim_end,
        channel_op=channel_op,
        normalize=normalize,
        encoder=encoder,
        bitrate_arg=bitrate_arg,
        measured=measured,
    )

    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="audiotoolbox_")
    proc = None
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err_fd, text=True)
        os.close(err_fd)
        err_fd = -1
        for line in iter(proc.stdout.readline, ""):
            if should_cancel(job_id):
                proc.kill()
                proc.wait()
                _safe_remove(tmp)
                _safe_remove(err_path)
                return False, "Cancelled"
            line = line.strip()
            if line.startswith("out_time_ms=") and duration > 0 and progress_cb:
                try:
                    ms = int(line.split("=", 1)[1])
                    if ms > 0:
                        progress_cb(min(ms / 1_000_000 / duration, 0.99))
                except (ValueError, IndexError):
                    pass
        proc.wait()
        if proc.returncode != 0:
            with open(err_path, errors="replace") as fh:
                stderr_text = fh.read()[-512:]
            _safe_remove(tmp)
            _safe_remove(err_path)
            return False, stderr_text or f"ffmpeg exit {proc.returncode}"
        _safe_remove(err_path)

        if keep_original:
            originals_dir = os.path.join(os.path.dirname(src), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            dest = os.path.join(originals_dir, os.path.basename(src))
            if os.path.exists(dest):
                b, e = os.path.splitext(os.path.basename(src))
                rid = _row_id_for(src)
                dest = os.path.join(originals_dir, f"{b}_{rid}{e}")
                n = 1
                while os.path.exists(dest):
                    dest = os.path.join(originals_dir, f"{b}_{rid}_{n}{e}")
                    n += 1
            shutil.move(src, dest)
        os.replace(tmp, src)

        db = SessionLocal()
        try:
            row = db.query(AudioFile).filter(AudioFile.path == src).first()
            if row is not None:
                row.compressed_at = now()
                db.commit()
                audio_scanner.rescan_audio_file(db, row)
        finally:
            db.close()
        return True, None
    except Exception as exc:  # noqa: BLE001 - report, don't crash the job
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
        _safe_remove(tmp)
        _safe_remove(err_path)
        return False, str(exc)


def run_audio_toolbox_job(
    job_id: int, file_ids: list[int], settings: dict, keep_original: bool
) -> None:
    """Job body: apply the toolbox ops to every file in `file_ids`.

    Progress is reported on the 0–100 scale (like `toolbox.py` /
    `audio_compressor.py`): each in-flight file folds its own fractional ffmpeg
    progress into the aggregate, and `job.current_file` names whichever file(s)
    are being worked on right now.
    """
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        paths: list[str] = [
            r.path for r in db.query(AudioFile).filter(AudioFile.id.in_(file_ids)).all()
        ]
        job.total_files = len(paths)
        db.commit()
        try:
            n_concurrent = max(1, int(get_setting(db, "max_concurrent_audio_transcodes", "1")))
        except (TypeError, ValueError):
            n_concurrent = 1

        total = len(paths)
        results: list[dict] = []
        fracs: dict[str, float] = {}
        fracs_lock = threading.Lock()

        arm_cancel(job_id)

        def make_progress_cb(path: str) -> Callable[[float], None]:
            def cb(frac: float) -> None:
                with fracs_lock:
                    fracs[path] = frac

            return cb

        def do_one(path: str) -> dict:
            ok, err = _toolbox_fix_one(
                path, settings, keep_original, job_id, progress_cb=make_progress_cb(path)
            )
            with fracs_lock:
                fracs.pop(path, None)
            return {"path": path, "ok": ok, "error": err}

        def flush_to_db() -> None:
            with fracs_lock:
                in_flight = sum(fracs.values())
                active_names = [os.path.basename(p) for p in fracs]
            processed = len(results)
            pct = (processed + in_flight) / total * 100 if total else 100.0
            job.progress = min(pct, 99.0)
            job.processed_files = processed
            job.current_file = " · ".join(active_names) if active_names else None
            db.commit()

        try:
            with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
                future_map = {pool.submit(do_one, p): p for p in paths}
                pending = set(future_map)
                while pending:
                    done, pending = _cf.wait(pending, timeout=2.0)
                    if should_cancel(job_id):
                        for f in pending:
                            f.cancel()
                        _cf.wait(pending)
                        pending = set()
                    for fut in done:
                        try:
                            results.append(fut.result())
                        except _cf.CancelledError:
                            continue
                    flush_to_db()
        finally:
            clear_cancel(job_id)

        cancelled = should_cancel(job_id) or any(r["error"] == "Cancelled" for r in results)
        failed = [r for r in results if not r["ok"] and r["error"] != "Cancelled"]
        job.status = (
            JobStatus.CANCELLED
            if cancelled
            else JobStatus.FAILED
            if failed and not any(r["ok"] for r in results)
            else JobStatus.COMPLETED
        )
        job.finished_at = now()
        job.progress = 100.0
        job.processed_files = len(results)
        job.current_file = None
        existing = json.loads(job.settings) if job.settings else {}
        existing["results"] = results
        job.settings = json.dumps(existing)
        if failed:
            job.error = f"{len(failed)} file(s) failed: " + "; ".join(
                f"{os.path.basename(r['path'])}: {r['error']}" for r in failed[:5]
            )
        db.commit()
    finally:
        db.close()
