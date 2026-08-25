import concurrent.futures as _cf
import os
import queue as _queue
import re
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable

from app.database import SessionLocal
from app.models.job import Job, JobStatus
from app.services.common import arm_cancel, clear_cancel, log, now, should_cancel
from app.services.compressor import _NEEDS_REMUX, _cleanup, _read_and_remove, _rescan_after_job
from app.services.encoder import encoder_for_codec

_HEVC_ENCODERS = {"libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_vaapi"}

_TRIM_KEYFRAME_TOLERANCE = 0.5  # seconds — how close a preceding keyframe must be
# to trust a stream-copy trim at trim_start. Beyond this, ffmpeg's copy-mode seek
# silently snaps back to that earlier keyframe while the requested duration is
# still computed from the (unreached) target — producing a barely-trimmed or
# untrimmed output that still reports success. Forcing a re-encode in that case
# is correct: a single `-ss` before `-i` is frame-accurate once ffmpeg is actually
# decoding (verified empirically — this is not true in `-c copy` mode, which is
# exactly why this check exists).


def _build_toolbox_cmd(
    input_path: str,
    output_path: str,
    duration: float,
    trim_start: float,
    trim_end: float,
    audio_channel: str
    | None,  # "left" | "right" | None — already resolved, "auto" is resolved upstream
    rotate_deg: int | None,  # 90 | 180 | 270 | None
    normalize: bool,
    faststart: bool,
    sync_offset_ms: float | None,
    source_codec: str
    | None = None,  # e.g. "h264", "hevc", "av1" — used to pick rotate's output codec
    force_video_reencode: bool = False,
    copy_seek_start: float | None = None,  # actual keyframe-snapped seek point, copy-mode only
    rebase_pts: bool = False,  # matroska-family output needs pts rezeroed after a trimmed reencode
) -> list[str]:
    needs_video_reencode = rotate_deg is not None or force_video_reencode
    needs_audio_reencode = audio_channel is not None or normalize or rebase_pts
    has_dual_input = sync_offset_ms is not None

    ss_args = ["-ss", str(trim_start)] if trim_start > 0 else []

    cmd = ["ffmpeg", "-y", *ss_args, "-i", input_path]

    if has_dual_input:
        cmd += [*ss_args, "-itsoffset", str(sync_offset_ms / 1000), "-i", input_path]
        cmd += ["-map", "0:v:0", "-map", "1:a?", "-map", "0:s?", "-map_chapters", "0"]
    else:
        cmd += ["-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-map_chapters", "0"]

    if trim_start > 0 or trim_end > 0:
        # In copy mode, ffmpeg's `-ss` seek actually lands on `copy_seek_start`
        # (the nearest preceding keyframe), not on `trim_start` — so the clip
        # length must be measured from there or the requested tail gets clipped.
        if copy_seek_start is not None and not needs_video_reencode:
            seek_start = copy_seek_start
        else:
            seek_start = trim_start
        clip_len = duration - seek_start - trim_end
        cmd += ["-t", str(clip_len)]

    vf_filters = []
    if rotate_deg == 90:
        vf_filters.append("transpose=1")
    elif rotate_deg == 270:
        vf_filters.append("transpose=2")
    elif rotate_deg == 180:
        vf_filters.append("transpose=1,transpose=1")
    if rebase_pts:
        # Matroska/webm muxing preserves the source's absolute timestamps after a
        # reencoded `-ss` trim (unlike mp4, which rezeros automatically) — the
        # container's declared duration ends up wrong (full original length, not
        # the trimmed length) unless pts is explicitly rebased to start at 0.
        vf_filters.append("setpts=PTS-STARTPTS")
    if vf_filters:
        cmd += ["-vf", ",".join(vf_filters)]

    out_ext = os.path.splitext(output_path)[1].lower()

    if needs_video_reencode:
        encoder = encoder_for_codec(source_codec)
        cmd += ["-c:v", encoder, "-crf", "18", "-preset", "medium"]
        if encoder in _HEVC_ENCODERS and out_ext in {".mp4", ".m4v", ".mov"}:
            cmd += ["-tag:v", "hvc1"]
    else:
        cmd += ["-c:v", "copy"]

    af_filters = []
    if audio_channel == "left":
        af_filters.append("pan=stereo|c0=c0|c1=c0")
    elif audio_channel == "right":
        af_filters.append("pan=stereo|c0=c1|c1=c1")
    if rebase_pts:
        af_filters.append("asetpts=PTS-STARTPTS")
    if normalize:
        af_filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    if af_filters:
        cmd += ["-af", ",".join(af_filters)]

    cmd += ["-c:a", "aac", "-b:a", "192k"] if needs_audio_reencode else ["-c:a", "copy"]
    cmd += ["-c:s", "copy"]

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


def _parse_last_keyframe_at_or_before(csv_output: str, target: float) -> float | None:
    """Parse ffprobe `packet=pts_time,flags` CSV output (one `pts,flags` pair per
    line, flags containing 'K' for a keyframe packet). Returns the pts_time of the
    last keyframe at or before `target` seconds, or None if none is found."""
    last_kf: float | None = None
    for line in csv_output.strip().splitlines():
        parts = line.split(",")
        if len(parts) != 2:
            continue
        pts_str, flags = parts
        if "K" not in flags:
            continue
        try:
            pts = float(pts_str)
        except ValueError:
            continue
        if pts <= target and (last_kf is None or pts > last_kf):
            last_kf = pts
    return last_kf


def _nearest_keyframe_at_or_before(path: str, target: float) -> float | None:
    """Probe the video stream for the last keyframe at or before `target` seconds —
    the point ffmpeg's stream-copy seek will actually land on for `-ss target`."""
    # Bound the interval's start so ffprobe seeks near `target` instead of
    # demuxing every packet from the start of the file — an unbounded `%target`
    # is cheap for early trims but reads the whole prefix (and can time out) on
    # a deep trim into a long file. Any keyframe outside this window is already
    # further than _TRIM_KEYFRAME_TOLERANCE away, so it would force a re-encode
    # regardless — narrowing the window doesn't change the result.
    window_start = max(0.0, target - 30)
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "packet=pts_time,flags",
                "-read_intervals",
                f"{window_start}%{target}",
                "-of",
                "csv=p=0",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        return None
    return _parse_last_keyframe_at_or_before(proc.stdout, target)


def detect_louder_channel(path: str) -> str:
    """Detect louder audio channel ('left' or 'right') by RMS level."""
    proc = subprocess.run(
        ["ffmpeg", "-i", path, "-t", "120", "-filter:a", "astats", "-f", "null", "-"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    rms = parse_channel_rms(proc.stderr)
    left_db = rms.get(1, float("-inf"))
    right_db = rms.get(2, float("-inf"))
    return "left" if left_db >= right_db else "right"


def _resolve_audio_channel(path: str, audio_channel: str | None) -> str | None:
    if audio_channel == "auto":
        return detect_louder_channel(path)
    return audio_channel


def _toolbox_fix_one(
    file_path: str,
    settings: dict,
    job_id: int,
    progress_cb: Callable[[float], None] | None = None,
    note_cb: Callable[[str], None] | None = None,
    keep_original: bool = True,
) -> tuple[bool, str | None, str | None]:
    """Apply the configured fix(es) to one file in-place.

    Returns (success, error_msg, final_path). final_path is the file's path after
    the fix — usually unchanged, but differs from the input path when a forced
    video reencode required remuxing out of a container that can't hold the
    chosen encoder (e.g. .webm -> .mkv). None when the fix failed.
    """
    if should_cancel(job_id):
        return False, "Cancelled", None
    src = file_path
    base, ext = os.path.splitext(src)

    duration = 0.0
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-print_format",
                "csv=p=0",
                src,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if probe.stdout.strip():
            duration = float(probe.stdout.strip().split("\n")[0])
    except Exception:
        pass

    trim_start = settings.get("trim_start") or 0
    trim_end = settings.get("trim_end") or 0

    if (trim_start > 0 or trim_end > 0) and (
        duration <= 0 or duration - trim_start - trim_end < 1.0
    ):
        return False, "Could not determine file duration or trim exceeds duration", None

    force_video_reencode = False
    nearest_kf: float | None = None
    if trim_start > 0:
        if should_cancel(job_id):
            return False, "Cancelled", None
        nearest_kf = _nearest_keyframe_at_or_before(src, trim_start)
        if nearest_kf is None or (trim_start - nearest_kf) > _TRIM_KEYFRAME_TOLERANCE:
            force_video_reencode = True
            if note_cb:
                note_cb(
                    f"Trim: no keyframe within {_TRIM_KEYFRAME_TOLERANCE}s of "
                    f"{trim_start}s — re-encoding video"
                )

    needs_video_reencode = settings.get("rotate_deg") is not None or force_video_reencode

    if needs_video_reencode and ext.lower() in _NEEDS_REMUX:
        # The chosen hardware/software encoder is almost always H.264/HEVC —
        # webm/flv/avi/wmv can't hold those, so remux into mkv (same as Compress
        # does for the identical container set) instead of forcing a slow,
        # GPU-less codec just to keep the original extension.
        out_ext = ".mkv"
    else:
        out_ext = ext.lower() or ".mkv"
    tmp = base + ".fixing" + out_ext
    dst = src if out_ext == ext.lower() else (base + out_ext)

    # Matroska (the only remux target, and a source that's already native .mkv)
    # doesn't auto-rezero timestamps after a reencoded `-ss` trim the way mp4
    # does — see _build_toolbox_cmd's rebase_pts handling.
    rebase_pts = trim_start > 0 and needs_video_reencode and out_ext == ".mkv"

    audio_setting = settings.get("audio_channel")
    try:
        audio_channel = _resolve_audio_channel(src, audio_setting)
    except Exception:
        if audio_setting == "auto":
            return False, "Could not detect louder audio channel", None
        audio_channel = None

    if audio_channel == "right":
        channel_count = 2
        try:
            ch_probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=channels",
                    "-of",
                    "csv=p=0",
                    src,
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if ch_probe.stdout.strip():
                channel_count = int(ch_probe.stdout.strip().split("\n")[0])
        except Exception:
            pass
        if channel_count < 2:
            return False, "Source has no right channel — file is mono", None

    source_codec = None
    if settings.get("rotate_deg") is not None or force_video_reencode:
        try:
            codec_probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "csv=p=0",
                    src,
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if codec_probe.stdout.strip():
                source_codec = codec_probe.stdout.strip().split("\n")[0]
        except Exception:
            pass

    cmd = _build_toolbox_cmd(
        src,
        tmp,
        duration,
        trim_start=trim_start,
        trim_end=trim_end,
        audio_channel=audio_channel,
        rotate_deg=settings.get("rotate_deg"),
        normalize=settings.get("normalize", False),
        faststart=settings.get("faststart", False),
        sync_offset_ms=settings.get("sync_offset_ms"),
        source_codec=source_codec,
        force_video_reencode=force_video_reencode,
        copy_seek_start=nearest_kf,
        rebase_pts=rebase_pts,
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
                return False, "Cancelled", None

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
                None,
            )

        _cleanup(err_path)

        if keep_original:
            originals_dir = os.path.join(os.path.dirname(src), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            shutil.move(src, os.path.join(originals_dir, os.path.basename(src)))
        else:
            os.remove(src)

        shutil.move(tmp, dst)
        return True, None, dst

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
        return False, str(e), None


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
            ok, err, final_path = _toolbox_fix_one(
                path,
                settings,
                job_id,
                progress_cb=make_progress_cb(path),
                note_cb=lambda msg: log_q.put(("info", msg)),
                keep_original=keep_original,
            )
            with fracs_lock:
                fracs.pop(path, None)
            if ok:
                _rescan_after_job(path, final_path)
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
