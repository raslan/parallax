"""Splice (merge) — concatenate several videos into one new file.

Pure helpers first (probe parsing, compatibility verdict, concat list,
chapters, ffmpeg arg builders), then `perform_merge` (ffmpeg → verify → move
sources to `_originals/` → rename into place; no DB) and `run_splice_job`
(the Job wrapper + watcher rescan).
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass

from app.database import SessionLocal
from app.models.job import Job, JobStatus
from app.services.common import (
    arm_cancel,
    clear_cancel,
    fail_job,
    log,
    now,
    should_cancel,
    temp_sibling_path,
)
from app.services.compressor import _encoder_args, _resolve_encoder
from app.services.encoder import family_for_encoder
from app.services.gpu_pool import GPUDevice, GpuPool

logger = logging.getLogger(__name__)

_FPS_TOLERANCE = 0.01
_NAME_MAX_BYTES = 200
_FORBIDDEN_NAME_CHARS = set("/\\\x00")


@dataclass(frozen=True)
class StreamFacts:
    path: str
    duration: float
    vcodec: str | None
    width: int | None
    height: int | None
    fps: float | None
    pix_fmt: str | None
    acodec: str | None
    sample_rate: int | None
    channels: int | None
    rotation: int = 0  # display rotation in degrees, legacy `rotate` tag convention (0/90/180/270)

    @property
    def has_audio(self) -> bool:
        return self.acodec is not None


def _fraction(value: str | None) -> float | None:
    if not value:
        return None
    try:
        if "/" in value:
            num, den = value.split("/", 1)
            return float(num) / float(den) if float(den) else None
        return float(value)
    except ValueError:
        return None


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rotation(video: dict) -> int:
    """Display rotation of a video stream, normalised to the legacy `rotate` tag
    convention. ffprobe reports a Display Matrix rotation with the opposite sign."""
    for side in video.get("side_data_list") or []:
        if "rotation" in side:
            try:
                return round(-float(side["rotation"])) % 360
            except (TypeError, ValueError):
                return 0
    try:
        return round(float((video.get("tags") or {}).get("rotate", 0))) % 360
    except (TypeError, ValueError):
        return 0


def parse_probe(path: str, data: dict) -> StreamFacts:
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return StreamFacts(
        path=path,
        duration=duration,
        vcodec=video.get("codec_name"),
        width=_int(video.get("width")),
        height=_int(video.get("height")),
        fps=_fraction(video.get("r_frame_rate")),
        pix_fmt=video.get("pix_fmt"),
        acodec=audio.get("codec_name"),
        sample_rate=_int(audio.get("sample_rate")),
        channels=_int(audio.get("channels")),
        rotation=_rotation(video),
    )


class ProbeError(RuntimeError):
    """A source file could not be probed (missing, unreadable, not a video)."""


def probe_facts(path: str) -> StreamFacts:
    name = os.path.basename(path)
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired as e:
        raise ProbeError(f"Probing {name} timed out") from e
    except OSError as e:
        raise ProbeError(f"Could not run ffprobe on {name}: {e}") from e
    try:
        facts = parse_probe(path, json.loads(result.stdout or "{}"))
    except ValueError as e:
        raise ProbeError(f"Could not read {name}") from e
    if result.returncode != 0:
        raise ProbeError(f"Could not read {name}")
    if facts.vcodec is None:
        raise ProbeError(f"{name} has no video stream")
    return facts


def mismatch_reasons(ref: StreamFacts, other: StreamFacts) -> list[str]:
    reasons: list[str] = []
    if other.vcodec != ref.vcodec:
        reasons.append(f"video codec {other.vcodec} ≠ {ref.vcodec}")
    if (other.width, other.height) != (ref.width, ref.height):
        reasons.append(f"resolution {other.width}×{other.height} ≠ {ref.width}×{ref.height}")
    if (other.fps is None) != (ref.fps is None) or (
        other.fps is not None and ref.fps is not None and abs(other.fps - ref.fps) > _FPS_TOLERANCE
    ):
        reasons.append(f"frame rate {other.fps} ≠ {ref.fps}")
    if other.rotation != ref.rotation:
        reasons.append(f"rotation {other.rotation}° ≠ {ref.rotation}°")
    if other.pix_fmt != ref.pix_fmt:
        reasons.append(f"pixel format {other.pix_fmt} ≠ {ref.pix_fmt}")
    if ref.has_audio and not other.has_audio:
        reasons.append("no audio (silence will be added)")
    elif other.has_audio and not ref.has_audio:
        reasons.append("has audio but the reference has none")
    elif other.has_audio:
        if other.acodec != ref.acodec:
            reasons.append(f"audio codec {other.acodec} ≠ {ref.acodec}")
        if other.sample_rate != ref.sample_rate:
            reasons.append(f"sample rate {other.sample_rate} ≠ {ref.sample_rate}")
        if other.channels != ref.channels:
            reasons.append(f"channels {other.channels} ≠ {ref.channels}")
    return reasons


def verdict_for(ref: StreamFacts, others: list[StreamFacts]) -> str:
    return "reencode" if any(mismatch_reasons(ref, o) for o in others) else "copy"


def validate_output_name(name: str) -> str:
    """Return the cleaned stem (the caller appends the extension)."""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Output name is empty")
    if any(c in _FORBIDDEN_NAME_CHARS for c in cleaned):
        raise ValueError("Output name may not contain path separators")
    if cleaned.startswith(".") or cleaned in {".", ".."}:
        raise ValueError("Output name may not start with a dot")
    if len(cleaned.encode()) > _NAME_MAX_BYTES:
        raise ValueError("Output name is too long")
    return cleaned


def build_concat_list(paths: list[str]) -> str:
    lines = []
    for p in paths:
        escaped = p.replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    return "\n".join(lines) + "\n"


def _meta_escape(text: str) -> str:
    for ch in ("\\", "=", ";", "#", "\n"):
        text = text.replace(ch, "\\" + ch)
    return text


def build_chapters_ffmetadata(items: list[tuple[str, float]]) -> str:
    out = [";FFMETADATA1"]
    start_ms = 0
    for title, duration in items:
        end_ms = start_ms + round(duration * 1000)
        out.append(
            f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={start_ms}\nEND={end_ms}\ntitle={_meta_escape(title)}"
        )
        start_ms = end_ms
    return "\n".join(out) + "\n"


def duration_ok(actual: float, expected: float) -> bool:
    if actual <= 0:
        return False
    return abs(actual - expected) <= max(2.0, expected * 0.01)


_SOFTWARE_ENCODERS = {"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1"}


def software_encoder(codec: str) -> str:
    return _SOFTWARE_ENCODERS.get(codec, "libx264")


def pick_output_ext(verdict: str, first_ext: str, codec: str | None) -> str:
    ext = first_ext.lower()
    if verdict == "copy":
        return ext or ".mkv"
    if codec in ("h264", "hevc") and ext in {".mp4", ".m4v", ".mov"}:
        return ".mp4"
    return ".mkv"


def build_copy_cmd(list_path: str, output_path: str, chapters_path: str | None) -> list[str]:
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path]
    if chapters_path:
        cmd += ["-i", chapters_path]
    cmd += ["-map", "0:v:0", "-map", "0:a:0?"]
    if chapters_path:
        cmd += ["-map_chapters", "1"]
    cmd += ["-c", "copy", "-progress", "pipe:1", "-nostats", output_path]
    return cmd


def _even(n: int | None, fallback: int) -> int:
    n = n or fallback
    return max(2, n - (n % 2))


def _fmt(n: float) -> str:
    return f"{n:g}"


def build_reencode_cmd(
    facts: list[StreamFacts],
    ref: StreamFacts,
    output_path: str,
    codec: str,
    crf: int,
    speed: str,
    chapters_path: str | None,
    gpu: GPUDevice | None,
    encoder: str | None = None,
) -> list[str]:
    w, h = _even(ref.width, 1280), _even(ref.height, 720)
    if ref.rotation in (90, 270):  # the filters auto-rotate, so the target is the displayed size
        w, h = h, w
    fps = _fmt(ref.fps or 24.0)
    rate = ref.sample_rate or 48000
    layout = "mono" if (ref.channels or 2) == 1 else "stereo"
    any_audio = any(f.has_audio for f in facts)
    enc = encoder or _resolve_encoder(codec)
    # VAAPI encodes from device surfaces: keep the software graph, then upload.
    vaapi = gpu is not None and enc in ("h264_vaapi", "hevc_vaapi")

    chains: list[str] = []
    labels: list[str] = []
    for i, f in enumerate(facts):
        chains.append(
            f"[{i}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{i}]"
        )
        labels.append(f"[v{i}]")
        if any_audio:
            if f.has_audio:
                chains.append(
                    f"[{i}:a:0]aresample={rate},"
                    f"aformat=sample_fmts=fltp:channel_layouts={layout}[a{i}]"
                )
            else:
                chains.append(
                    f"anullsrc=r={rate}:cl={layout},atrim=duration={_fmt(f.duration)},"
                    f"aformat=sample_fmts=fltp[a{i}]"
                )
            labels.append(f"[a{i}]")
    n = len(facts)
    vout = "[vc]" if vaapi else "[v]"
    if any_audio:
        chains.append(f"{''.join(labels)}concat=n={n}:v=1:a=1{vout}[a]")
    else:
        chains.append(f"{''.join(labels)}concat=n={n}:v=1:a=0{vout}")
    if vaapi:
        chains.append("[vc]format=nv12,hwupload[v]")

    cmd = ["ffmpeg", "-y"]
    if vaapi:
        cmd += ["-init_hw_device", f"vaapi=va:{gpu.index}", "-filter_hw_device", "va"]
    for f in facts:
        cmd += ["-i", f.path]
    if chapters_path:
        cmd += ["-i", chapters_path]
    cmd += ["-filter_complex", ";".join(chains), "-map", "[v]"]
    if any_audio:
        cmd += ["-map", "[a]"]
    if chapters_path:
        cmd += ["-map_chapters", str(n)]
    cmd += _encoder_args(enc, codec, crf, speed, gpu)
    if codec == "hevc" and output_path.lower().endswith((".mp4", ".m4v", ".mov")):
        cmd += ["-tag:v", "hvc1"]
    if any_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += ["-progress", "pipe:1", "-nostats", output_path]
    return cmd


GPU_FAILED_PREFIX = "GPU encode failed"  # job.error marker the UI/retry route key off


# Final output paths currently owned by a running merge: two concurrent jobs to the same
# folder + name would otherwise both pass the exists-check and the later move would
# silently replace the earlier job's finished output.
_RESERVED: set[str] = set()
_RESERVED_LOCK = threading.Lock()


class SpliceCancelled(Exception):
    pass


class GpuEncodeFailed(RuntimeError):
    """A hardware-encoder ffmpeg run failed; the caller may offer a CPU retry."""


def move_to_originals(path: str, file_id: int) -> str:
    originals = os.path.join(os.path.dirname(path), "_originals")
    os.makedirs(originals, exist_ok=True)
    name = os.path.basename(path)
    dest = os.path.join(originals, name)
    if os.path.exists(dest):  # same `_<id>` convention as the audio bulk delete
        base, ext = os.path.splitext(name)
        dest = os.path.join(originals, f"{base}_{file_id}{ext}")
        n = 0
        while os.path.exists(dest):
            n += 1
            dest = os.path.join(originals, f"{base}_{file_id}_{n}{ext}")
    shutil.move(path, dest)
    return dest


def _remove(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _run_ffmpeg(cmd, total: float, progress_cb, is_cancelled) -> None:
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="splice_")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err_fd, text=True)
    os.close(err_fd)
    try:
        for line in iter(proc.stdout.readline, ""):
            if is_cancelled():
                proc.kill()
                proc.wait()
                raise SpliceCancelled()
            line = line.strip()
            if line.startswith("out_time_ms=") and total > 0:
                try:
                    progress_cb(min(int(line.split("=")[1]) / 1_000_000 / total, 0.99))
                except ValueError:
                    pass
        proc.wait()
        if proc.returncode != 0:
            with open(err_path) as fh:
                tail = fh.read()[-512:]
            raise RuntimeError(tail or f"ffmpeg exit {proc.returncode}")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        _remove(err_path)


def perform_merge(
    ids: list[int],
    paths: list[str],
    settings: dict,
    progress_cb: Callable[[float], None],
    is_cancelled: Callable[[], bool],
    note_cb: Callable[[str], None] = lambda _m: None,
) -> str:
    facts = [probe_facts(p) for p in paths]
    total = sum(f.duration for f in facts)
    reencode = settings.get("reencode")
    codec = reencode["codec"] if reencode else None
    ext = pick_output_ext(settings["verdict"], os.path.splitext(paths[0])[1], codec)
    final = os.path.join(os.path.dirname(paths[0]), settings["output_name"] + ext)
    if os.path.exists(final) and final not in paths:
        raise RuntimeError(f"{os.path.basename(final)} already exists")

    tmp = temp_sibling_path(paths[0], ext, "compressing")
    used_hw_encoder = False
    aux: list[str] = []
    gpu = pool = None
    with _RESERVED_LOCK:
        if final in _RESERVED:
            raise RuntimeError(f"{os.path.basename(final)} is in use by another merge")
        _RESERVED.add(final)
    try:
        chapters_path = None
        if settings.get("chapters"):
            chapters_path = tmp + ".chapters.txt"
            aux.append(chapters_path)
            with open(chapters_path, "w", encoding="utf-8") as fh:
                fh.write(
                    build_chapters_ffmetadata(
                        [(os.path.splitext(os.path.basename(f.path))[0], f.duration) for f in facts]
                    )
                )
        if settings["verdict"] == "copy":
            list_path = tmp + ".list.txt"
            aux.append(list_path)
            with open(list_path, "w", encoding="utf-8") as fh:
                fh.write(build_concat_list(paths))
            cmd = build_copy_cmd(list_path, tmp, chapters_path)
        else:
            ref = facts[settings.get("reference_index", 0)]
            encoder = (
                software_encoder(reencode["codec"])
                if settings.get("force_cpu")
                else _resolve_encoder(reencode["codec"])
            )
            family = family_for_encoder(encoder)
            if family in ("nvenc", "vaapi"):
                pool = GpuPool.build(family, 1)
                gpu = pool.acquire_any() if pool.has_devices else None
            if family == "vaapi" and gpu is None:
                # VAAPI can't run without a render node to upload frames to.
                note_cb("No VAAPI device available — encoding on the CPU")
                encoder = software_encoder(reencode["codec"])
                family = "software"
            elif family == "nvenc" and gpu is None:
                note_cb("No NVIDIA device reported — trying the NVENC encoder anyway")
            # qsv/amf get no device plumbing in Compress/Toolbox either: run as resolved.
            used_hw_encoder = family != "software"
            cmd = build_reencode_cmd(
                facts,
                ref,
                tmp,
                reencode["codec"],
                reencode["crf"],
                reencode["speed"],
                chapters_path,
                gpu,
                encoder,
            )
        try:
            _run_ffmpeg(cmd, total, progress_cb, is_cancelled)
        except RuntimeError as e:
            if used_hw_encoder:
                raise GpuEncodeFailed(f"{GPU_FAILED_PREFIX}: {e}") from e
            raise

        if is_cancelled():
            raise SpliceCancelled()

        out = probe_facts(tmp)
        if out.vcodec is None or (any(f.has_audio for f in facts) and not out.has_audio):
            raise RuntimeError("Output failed verification: missing stream")
        if not duration_ok(out.duration, total):
            raise RuntimeError(
                f"Output failed verification: duration {out.duration:.1f}s vs expected {total:.1f}s"
            )

        if os.path.exists(final) and final not in paths:
            raise RuntimeError(f"{os.path.basename(final)} already exists")

        moved: list[tuple[str, str]] = []
        final_attempted = False
        try:
            for fid, p in zip(ids, paths, strict=True):
                moved.append((p, move_to_originals(p, fid)))
            final_attempted = True
            shutil.move(tmp, final)  # tmp may live on SCRATCH_DIR (another filesystem)
        except Exception as e:
            if final_attempted:
                _remove(final)  # a failed cross-fs move can leave a partial file behind
            stuck: list[str] = []
            for orig, dest in reversed(moved):
                try:
                    shutil.move(dest, orig)
                except OSError:
                    stuck.append(dest)
            msg = f"Could not finish the merge: {e}"
            if stuck:
                msg += ". These originals could not be restored and are still in _originals/: "
                msg += ", ".join(stuck)
            raise RuntimeError(msg) from e
        return final
    finally:
        with _RESERVED_LOCK:
            _RESERVED.discard(final)
        if pool is not None and gpu is not None:
            pool.release(gpu)
        _remove(tmp)
        for a in aux:
            _remove(a)


def run_splice_job(job_id: int, ids: list[int], paths: list[str], settings: dict) -> None:
    db = SessionLocal()
    job = None
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        job.current_file = "Merging " + ", ".join(os.path.basename(p) for p in paths[:3])
        db.commit()
        arm_cancel(job_id)

        def progress(frac: float) -> None:
            job.progress = min(frac * 100, 99.0)
            db.commit()

        try:
            final = perform_merge(
                ids,
                paths,
                settings,
                progress,
                lambda: should_cancel(job_id),
                lambda m: log(db, job_id, m),
            )
        except SpliceCancelled:
            job.status = JobStatus.CANCELLED
            job.finished_at = now()
            db.commit()
            log(db, job_id, "Merge cancelled — sources untouched")
            return
        except RuntimeError as e:  # includes GpuEncodeFailed — its message carries the retry marker
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
            log(db, job_id, f"Merge failed — {e}", "error")
            return

        try:  # immediate library refresh: prunes the moved sources, ingests the output
            from app.services import fs_watcher

            if not fs_watcher._apply("video", job.library_id, frozenset({final})):
                logger.info(
                    "Splice: library %s is scanning; the watcher will pick up %s",
                    job.library_id,
                    final,
                )
        except Exception as e:
            # Best effort — the watcher's own debounce will catch up — but say so.
            logger.warning("Splice: library refresh after merge failed: %s", e, exc_info=True)

        job.status = JobStatus.COMPLETED
        job.progress = 100.0
        job.processed_files = 1
        job.current_file = os.path.basename(final)
        job.finished_at = now()
        db.commit()
        log(db, job_id, f"Merged {len(paths)} files into {os.path.basename(final)}")
    except Exception as exc:
        fail_job(db, job, exc)
    finally:
        clear_cancel(job_id)
        db.close()
