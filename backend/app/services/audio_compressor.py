"""Audio re-encode: codec table, size estimate, ffmpeg builder, compress job.

Structurally this mirrors `services/compressor.py` (the video Compress page's job
runner) minus video concerns: a `concurrent.futures.ThreadPoolExecutor` +
`_cf.wait(pending, timeout=2.0)` poll loop, `should_cancel(job_id)` each
iteration, incremental `job.processed_files` / `job.progress` commits, and
`arm_cancel` / `clear_cancel` around the run.

`estimate_audio_size` / `audio_savings_pct` are a plain linear model (bitrate ×
duration + 2% container overhead); the same formulas are mirrored in TypeScript
on the Compress page, so keep them byte-for-byte identical.
"""

import concurrent.futures as _cf
import copy
import json
import os
import queue as _queue
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable

from app.database import SessionLocal
from app.models.audio_file import AudioFile
from app.models.job import Job, JobStatus
from app.services import audio_scanner
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel

# Static codec metadata. `get_available_audio_codecs()` returns a deep copy with
# aac's `encoder` resolved against the local ffmpeg build. `tiers` is ascending
# by `max_kbps` — the UI labels a chosen bitrate with the first tier it fits in.
AUDIO_CODECS: list[dict] = [
    {
        "id": "opus",
        "label": "Opus",
        "encoder": "libopus",
        "ext": ".opus",
        "bitrate_min": 32,
        "bitrate_default": 128,
        "bitrate_max": 256,
        "tiers": [
            {"max_kbps": 64, "label": "voice / low"},
            {"max_kbps": 96, "label": "good"},
            {"max_kbps": 128, "label": "transparent (music)"},
            {"max_kbps": 256, "label": "archival"},
        ],
    },
    {
        "id": "aac",
        "label": "AAC",
        "encoder": "aac",
        "ext": ".m4a",
        "bitrate_min": 64,
        "bitrate_default": 160,
        "bitrate_max": 320,
        "tiers": [
            {"max_kbps": 96, "label": "low"},
            {"max_kbps": 128, "label": "good"},
            {"max_kbps": 160, "label": "transparent"},
            {"max_kbps": 256, "label": "near-lossless"},
        ],
    },
    {
        "id": "mp3",
        "label": "MP3",
        "encoder": "libmp3lame",
        "ext": ".mp3",
        "bitrate_min": 96,
        "bitrate_default": 192,
        "bitrate_max": 320,
        "tiers": [
            {"max_kbps": 128, "label": "low"},
            {"max_kbps": 192, "label": "good"},
            {"max_kbps": 256, "label": "transparent"},
            {"max_kbps": 320, "label": "max"},
        ],
    },
]

_encoders_blob: str | None = None
_has_encoder_cache: dict[str, bool] = {}


def _encoders_output() -> str:
    """`ffmpeg -hide_banner -encoders` stdout, probed once and cached."""
    global _encoders_blob
    if _encoders_blob is None:
        try:
            result = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            _encoders_blob = result.stdout or ""
        except Exception:
            _encoders_blob = ""
    return _encoders_blob


def _has_encoder(name: str) -> bool:
    """True when the local ffmpeg build lists an encoder called `name`."""
    if name not in _has_encoder_cache:
        _has_encoder_cache[name] = name in _encoders_output()
    return _has_encoder_cache[name]


def get_available_audio_codecs() -> list[dict]:
    """A deep copy of `AUDIO_CODECS` with aac's encoder resolved.

    aac becomes `libfdk_aac` when that (non-free) encoder is compiled in,
    otherwise the built-in `aac`. opus and mp3 encoders are left as-is.
    """
    codecs = copy.deepcopy(AUDIO_CODECS)
    for codec in codecs:
        if codec["id"] == "aac":
            codec["encoder"] = "libfdk_aac" if _has_encoder("libfdk_aac") else "aac"
    return codecs


def estimate_audio_size(duration_s: float | None, bitrate_kbps: int) -> int:
    """Estimated output size in bytes: bitrate × duration + 2% container overhead.

    Returns 0 when `duration_s` is falsy or non-positive. Mirrored in TS on the
    Compress page — keep the arithmetic identical.
    """
    if not duration_s or duration_s <= 0:
        return 0
    return int(duration_s * bitrate_kbps * 1000 / 8 * 1.02)


def audio_savings_pct(source_bytes: int, est_bytes: int) -> float:
    """Percent smaller the estimate is vs the source, floored at 0, 1 decimal.

    Returns 0.0 when `source_bytes` is falsy. Mirrored in TS — keep identical.
    """
    if not source_bytes:
        return 0.0
    return max(0.0, round((1 - est_bytes / source_bytes) * 100, 1))


def _build_audio_cmd(inp: str, out: str, encoder: str, bitrate_kbps: int) -> list[str]:
    """ffmpeg argv for a metadata-preserving, video-stripping audio re-encode."""
    return [
        "ffmpeg",
        "-y",
        "-i",
        inp,
        "-vn",
        "-c:a",
        encoder,
        "-b:a",
        f"{bitrate_kbps}k",
        "-map_metadata",
        "0",
        "-map_metadata:s:a",
        "0",
        "-map_chapters",
        "0",
        "-progress",
        "pipe:1",
        "-nostats",
        out,
    ]


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


def _rescan_after_compress(old_path: str, final_path: str, ext: str) -> None:
    """Repoint the `AudioFile` row at the new file and re-probe it.

    Runs on a worker thread inside the job's thread pool — must not touch the job
    runner's own `db` session, so it opens its own short-lived one.
    """
    db = SessionLocal()
    try:
        row = db.query(AudioFile).filter(AudioFile.path == old_path).first()
        if row is None:
            return
        row.path = final_path
        row.filename = os.path.basename(final_path)
        row.extension = ext
        row.compressed_at = now()
        db.commit()
        audio_scanner.rescan_audio_file(db, row)
    except Exception:
        pass
    finally:
        db.close()


def _compress_one(
    src: str,
    encoder: str,
    ext: str,
    bitrate_kbps: int,
    job_id: int,
    duration: float = 0.0,
    progress_cb: Callable[[float], None] | None = None,
    keep_original: bool = True,
) -> tuple[bool, str | None]:
    """Re-encode one audio file in place. Returns (success, error_msg).

    On success the source is either moved into a sibling `_originals/` dir
    (`keep_original`) or deleted, the temp file is renamed to `base + ext`, and
    the DB row is repointed + re-probed. On ffmpeg failure the temp file is
    removed and the source is left untouched.
    """
    if should_cancel(job_id):
        return False, "Cancelled"

    base = os.path.splitext(src)[0]
    tmp = base + ".compressing" + ext  # the fs watcher skips `.compressing*`
    final = base + ext

    proc = None
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="audiocompress_")
    try:
        proc = subprocess.Popen(
            _build_audio_cmd(src, tmp, encoder, bitrate_kbps),
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
            return (
                False,
                (stderr_text[-512:] if stderr_text else f"ffmpeg exit {proc.returncode}"),
            )

        _cleanup(err_path)

        if keep_original:
            originals_dir = os.path.join(os.path.dirname(src), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            shutil.move(src, os.path.join(originals_dir, os.path.basename(src)))

        os.replace(tmp, final)

        if (
            not keep_original
            and os.path.abspath(src) != os.path.abspath(final)
            and os.path.exists(src)
        ):
            os.remove(src)

        _rescan_after_compress(src, final, ext)
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


def run_audio_compress_job(
    job_id: int,
    paths: list[str],
    codec: str,
    bitrate_kbps: int,
    keep_original: bool,
) -> None:
    """Job body: re-encode `paths` to `codec` @ `bitrate_kbps`.

    Mirrors `compressor.run_compress_job`. Files whose source bitrate is already
    at or below the target are recorded as *skipped* (not failed) and left
    alone — no lossy upconvert. The endpoint (Task 7) creates the `Job` row
    PENDING; this drives it RUNNING → COMPLETED and writes a result summary
    (including the skipped count) into `job.settings`.
    """
    from app.models.settings import get_setting

    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return

        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.total_files = len(paths)
        db.commit()

        total = len(paths)
        n_concurrent = max(1, int(get_setting(db, "max_concurrent_transcodes", "1")))

        codec_meta = next((c for c in get_available_audio_codecs() if c["id"] == codec), None)
        if codec_meta is None:
            raise ValueError(f"Unknown audio codec: {codec}")
        encoder = codec_meta["encoder"]
        ext = codec_meta["ext"]

        # Shared state — touched from worker threads under lock.
        fracs: dict[str, float] = {}
        fracs_lock = threading.Lock()
        log_q: _queue.SimpleQueue = _queue.SimpleQueue()
        completed = 0
        failed = 0
        skipped: list[str] = []
        was_cancelled = False

        arm_cancel(job_id)

        def make_progress_cb(path: str) -> Callable[[float], None]:
            def cb(frac: float) -> None:
                with fracs_lock:
                    fracs[path] = frac

            return cb

        def do_one(path: str) -> tuple[str, str, str | None]:
            """Returns (path, outcome, err); outcome ∈ {ok, skipped, error, cancelled}."""
            fname = os.path.basename(path)
            if should_cancel(job_id):
                return path, "cancelled", None

            meta = audio_scanner._probe_audio_metadata(path)
            src_bitrate = meta.get("bitrate")
            if src_bitrate and src_bitrate <= bitrate_kbps * 1000:
                log_q.put(("info", f"Skipped (already ≤ target bitrate): {fname}"))
                return path, "skipped", None

            log_q.put(("info", f"Compressing: {fname}"))
            ok, err = _compress_one(
                path,
                encoder,
                ext,
                bitrate_kbps,
                job_id,
                duration=meta.get("duration") or 0.0,
                progress_cb=make_progress_cb(path),
                keep_original=keep_original,
            )
            with fracs_lock:
                fracs.pop(path, None)
            if ok:
                return path, "ok", None
            if err == "Cancelled":
                return path, "cancelled", None
            return path, "error", err

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
            processed = completed + failed + len(skipped)
            pct = (processed + in_flight) / total * 100 if total else 100.0
            job.progress = min(pct, 99.0)
            job.processed_files = processed
            job.current_file = " · ".join(active_names) if active_names else None
            db.commit()

        with _cf.ThreadPoolExecutor(max_workers=n_concurrent) as pool:
            future_map = {pool.submit(do_one, path): path for path in paths}
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
                        path, outcome, err = fut.result()
                    except _cf.CancelledError:
                        continue
                    fname = os.path.basename(path)
                    if outcome == "ok":
                        completed += 1
                        log_q.put(("info", f"Done: {fname}"))
                    elif outcome == "skipped":
                        skipped.append(path)
                    elif outcome == "error":
                        failed += 1
                        log_q.put(("error", f"Failed: {fname} — {err}"))

                flush_to_db()

        # Drain any remaining log messages.
        while not log_q.empty():
            try:
                level, msg = log_q.get_nowait()
                log(db, job_id, msg, level)
            except _queue.Empty:
                break

        summary = {
            "codec": codec,
            "bitrate_kbps": bitrate_kbps,
            "keep_original": keep_original,
            "compressed": completed,
            "skipped": len(skipped),
            "failed": failed,
        }
        try:
            existing = json.loads(job.settings) if job.settings else {}
            if isinstance(existing, dict):
                existing.update(summary)
                summary = existing
        except (ValueError, TypeError):
            pass
        job.settings = json.dumps(summary)

        if was_cancelled:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            job.current_file = f"{completed}/{total} done before cancel"
            db.commit()
            log(
                db,
                job_id,
                f"Audio compress cancelled — {completed} done, "
                f"{len(skipped)} skipped, {failed} failed",
            )
            return

        if failed > 0:
            job.error = f"{failed} of {total} file(s) failed"
        job.status = JobStatus.FAILED if (failed > 0 and completed == 0) else JobStatus.COMPLETED
        job.progress = 100.0
        job.processed_files = completed + failed + len(skipped)
        job.finished_at = now()
        job.current_file = f"{completed}/{total} compressed, {len(skipped)} skipped"
        db.commit()
        log(
            db,
            job_id,
            f"Audio compress complete — {completed} compressed, "
            f"{len(skipped)} skipped, {failed} failed",
        )

    except Exception as exc:
        if job:
            job.status = JobStatus.FAILED
            job.error = str(exc)[:512]
            job.finished_at = now()
            db.commit()
    finally:
        clear_cancel(job_id)
        db.close()
