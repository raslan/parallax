import json
import logging
import os
import subprocess
import tempfile
import threading
import time

from app.config import DATA_DIR
from app.services.video_analyzer import get_video_duration

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(DATA_DIR, "stream-cache")
_CACHE_FILE = os.path.join(CACHE_DIR, "current.mp4")
_MARKER_FILE = os.path.join(CACHE_DIR, "current.json")
_IDLE_TTL_SECONDS = 3600

# Codecs browsers can decode natively in an HTML5 <video> element — anything
# else (AC3/DTS/TrueHD etc, common in movie rips) plays with no audio.
_WEB_SAFE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}

_lock = threading.Lock()
_done_event = threading.Event()
_done_event.set()
_state = {"path": None, "status": "idle", "progress": 0.0, "error": None}


def _probe_audio_codec(video_path: str) -> str | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-select_streams", "a:0",
             "-show_entries", "stream=codec_name",
             video_path],
            capture_output=True, text=True, timeout=30,
        )
        streams = json.loads(result.stdout).get("streams") or []
        return streams[0]["codec_name"] if streams else None
    except Exception:
        return None


def _clear_cache() -> None:
    for f in (_CACHE_FILE, _MARKER_FILE):
        try:
            os.remove(f)
        except OSError:
            pass


def _source_signature(video_path: str) -> dict:
    st = os.stat(video_path)
    return {"path": video_path, "mtime": st.st_mtime, "size": st.st_size}


def _read_marker() -> dict | None:
    try:
        with open(_MARKER_FILE) as fh:
            return json.load(fh)
    except Exception:
        return None


def _cached_ready(video_path: str) -> bool:
    return _read_marker() == _source_signature(video_path) and os.path.exists(_CACHE_FILE)


def _sweep_idle_locked() -> None:
    """Evict the cached remux once it's gone untouched past the TTL. Caller holds _lock."""
    if _state["status"] == "running":
        return
    try:
        age = time.time() - os.path.getmtime(_CACHE_FILE)
    except OSError:
        return
    if age > _IDLE_TTL_SECONDS:
        _clear_cache()


def needs_prepare(video_path: str) -> dict:
    """Non-blocking status check. Does not start a remux — call start_prepare() for that."""
    codec = _probe_audio_codec(video_path)
    if codec is None or codec in _WEB_SAFE_AUDIO_CODECS:
        return {"status": "ready", "progress": 100.0, "error": None}

    with _lock:
        _sweep_idle_locked()
        if _cached_ready(video_path):
            os.utime(_CACHE_FILE, None)
            return {"status": "ready", "progress": 100.0, "error": None}
        if _state["path"] == video_path and _state["status"] in ("running", "error"):
            return {"status": _state["status"], "progress": _state["progress"], "error": _state["error"]}
    return {"status": "not_started", "progress": 0.0, "error": None}


def start_prepare(video_path: str) -> dict:
    """Idempotent: kicks off a background remux if one isn't already covering this
    file, and always returns the current status (same shape as needs_prepare)."""
    status = needs_prepare(video_path)
    if status["status"] in ("ready", "running"):
        return status

    with _lock:
        # Re-check inside the lock in case another request just started it.
        if _state["path"] == video_path and _state["status"] == "running":
            return {"status": "running", "progress": _state["progress"], "error": None}
        _clear_cache()
        _state.update(path=video_path, status="running", progress=0.0, error=None)
        _done_event.clear()

    threading.Thread(target=_run_remux, args=(video_path,), daemon=True).start()
    return {"status": "running", "progress": 0.0, "error": None}


def _run_remux(video_path: str) -> None:
    duration = get_video_duration(video_path) or 0.0
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp_path = _CACHE_FILE + ".tmp"

    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="stream_remux_")
    proc = None
    try:
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-i", video_path,
             # Explicit map: without it ffmpeg can also grab a subtitle or
             # attachment stream (fonts etc.) from the source that the mp4
             # muxer can't hold, failing the whole remux.
             "-map", "0:v:0", "-map", "0:a:0",
             "-c:v", "copy", "-c:a", "aac", "-ac", "2",
             "-movflags", "+faststart", "-f", "mp4",
             "-progress", "pipe:1", "-nostats",
             tmp_path],
            stdout=subprocess.PIPE, stderr=err_fd, text=True,
        )
        os.close(err_fd)
        err_fd = -1

        for line in iter(proc.stdout.readline, ""):
            line = line.strip()
            if line.startswith("out_time_ms=") and duration > 0:
                try:
                    ms = int(line.split("=", 1)[1])
                    with _lock:
                        _state["progress"] = min(99.0, ms / 1_000_000 / duration * 100)
                except ValueError:
                    pass

        ret = proc.wait(timeout=600)
        if ret != 0:
            with open(err_path, errors="replace") as fh:
                stderr = fh.read()[-2000:]
            raise RuntimeError(f"ffmpeg exit {ret}: {stderr}")

        os.rename(tmp_path, _CACHE_FILE)
        with open(_MARKER_FILE, "w") as fh:
            json.dump(_source_signature(video_path), fh)
        with _lock:
            _state.update(status="ready", progress=100.0, error=None)
    except Exception as exc:
        logger.warning("Stream remux failed for %s: %s", video_path, exc)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        with _lock:
            _state.update(status="error", error=str(exc)[:1000])
    finally:
        if err_fd != -1:
            os.close(err_fd)
        try:
            os.remove(err_path)
        except OSError:
            pass
        _done_event.set()


def get_stream_path(video_path: str) -> str:
    """Blocking safety net for direct stream requests that skipped /prepare.
    Waits for any in-flight remux (starting one if none is running) rather
    than racing a duplicate."""
    status = needs_prepare(video_path)
    if status["status"] == "ready":
        return _CACHE_FILE if _cached_ready(video_path) else video_path
    if status["status"] == "not_started":
        start_prepare(video_path)
    _done_event.wait(timeout=630)
    return _CACHE_FILE if _cached_ready(video_path) else video_path
