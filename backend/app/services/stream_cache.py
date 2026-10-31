import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time

from app.config import DATA_DIR
from app.services.video_analyzer import get_video_duration

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(DATA_DIR, "stream-cache")
_PLAYLIST = "index.m3u8"
# The Video.js HLS engine loads a multivariant playlist (with CODECS), not a bare media
# playlist, so the player is pointed at this one-rendition wrapper around `index.m3u8`.
_MASTER = "master.m3u8"
_INIT = "init.mp4"
_SEGMENT_SECONDS = 6
# Enough segments queued that the player can start without immediately stalling.
_PLAYABLE_SEGMENTS = 2
_IDLE_TTL_SECONDS = 3600
# A run nobody has polled or fetched from in this long (modal closed) is killed so it
# doesn't keep writing a whole movie's worth of segments to disk.
_STALL_SECONDS = 300

# Codecs browsers can decode natively in an HTML5 <video> element — anything
# else (AC3/DTS/TrueHD etc, common in movie rips) plays with no audio.
_WEB_SAFE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}

_SID_RE = re.compile(r"[0-9a-f]{8}")
_NAME_RE = re.compile(r"[A-Za-z0-9_-]+\.(?:m3u8|mp4|m4s)")

_lock = threading.Lock()
_proc: subprocess.Popen | None = None
# status: idle | running | done | error | stopped
_state = {
    "path": None,
    "sid": None,
    "status": "idle",
    "progress": 0.0,
    "error": None,
    "touched": 0.0,
}


def _probe_codecs(video_path: str) -> tuple[str | None, str | None]:
    """(video codec, audio codec) of the first stream of each kind; None where absent."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_entries",
                "stream=codec_type,codec_name",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        streams = json.loads(result.stdout).get("streams") or []
    except Exception:
        return None, None
    found: dict[str, str] = {}
    for s in streams:
        found.setdefault(s.get("codec_type"), s.get("codec_name"))
    return found.get("video"), found.get("audio")


def _session_dir(sid: str) -> str:
    return os.path.join(CACHE_DIR, sid)


def _video_codec_string(init: bytes) -> str | None:
    """RFC 6381 codec string of the copied video track, read from its avcC/hvcC box."""
    i = init.find(b"avcC")
    if i >= 0 and len(init) >= i + 8:
        return "avc1." + init[i + 5 : i + 8].hex()
    i = init.find(b"hvcC")
    if i >= 0 and len(init) >= i + 17:
        b = init[i + 4 : i + 17]
        # general_profile_space, tier flag, profile_idc, reversed compat flags, level, constraints
        space = "ABC"[b[1] >> 6] if b[1] >> 6 else ""
        compat = int(f"{int.from_bytes(b[2:6], 'big'):032b}"[::-1], 2)
        constraints = ".".join(f"{c:02x}" for c in b[6:12].rstrip(b"\0"))
        tier = "H" if b[1] & 0x20 else "L"
        parts = [f"hvc1.{space}{b[1] & 0x1F}", f"{compat:x}", f"{tier}{b[12]}"]
        return ".".join(parts + ([constraints] if constraints else []))
    return None


def _write_master(sid: str) -> bool:
    """Write the multivariant playlist once the init segment shows the codecs; True if present."""
    path = os.path.join(_session_dir(sid), _MASTER)
    if os.path.exists(path):
        return True
    try:
        with open(os.path.join(_session_dir(sid), _INIT), "rb") as fh:
            video = _video_codec_string(fh.read())
    except OSError:
        return False
    if video is None:
        return False
    text = (
        "#EXTM3U\n"
        f'#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="{video},mp4a.40.2"\n'
        f"{_PLAYLIST}\n"
    )
    with open(path + ".tmp", "w") as fh:
        fh.write(text)
    os.replace(path + ".tmp", path)
    return True


def _clear_cache() -> None:
    """Remove every session directory (and any pre-HLS `current.mp4` left by an older build)."""
    try:
        entries = os.listdir(CACHE_DIR)
    except OSError:
        return
    for name in entries:
        path = os.path.join(CACHE_DIR, name)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except OSError:
                pass


def _stop_proc_locked() -> None:
    """Terminate the running ffmpeg, if any. Caller holds _lock."""
    if _proc is not None and _proc.poll() is None:
        _proc.terminate()


def _playable(sid: str, done: bool) -> bool:
    """True once the master exists and the playlist lists enough segments to start."""
    if not os.path.exists(os.path.join(_session_dir(sid), _MASTER)):
        return False
    try:
        with open(os.path.join(_session_dir(sid), _PLAYLIST)) as fh:
            text = fh.read()
    except OSError:
        return False
    return text.count("#EXTINF") >= (1 if done else _PLAYABLE_SEGMENTS)


def _sweep_locked() -> None:
    """Kill a stalled run, then evict a finished session once idle. Caller holds _lock."""
    idle = time.time() - _state["touched"]
    if _state["status"] == "running":
        if idle > _STALL_SECONDS:
            _stop_proc_locked()
            _state["status"] = "stopped"
        return
    if _state["sid"] and idle > _IDLE_TTL_SECONDS:
        shutil.rmtree(_session_dir(_state["sid"]), ignore_errors=True)
        _state.update(path=None, sid=None, status="idle")


# ── Background sweeper ────────────────────────────────────────────────────────
# Runs independent of playback: a hard clear on boot plus a frequent idle check, so a session
# whose source was later deleted, or that simply wasn't replayed, never parks GBs indefinitely.

_SWEEP_INTERVAL_SECONDS = 30
_sweeper_stop = threading.Event()
_sweeper_thread: threading.Thread | None = None


def _sweeper_loop() -> None:
    while not _sweeper_stop.wait(_SWEEP_INTERVAL_SECONDS):
        with _lock:
            _sweep_locked()


def start_sweeper() -> None:
    """Clear any leftover session on boot, then idle-sweep on a timer.

    Called once from the app lifespan. The HLS session is a single-slot throwaway rebuilt on
    demand, so clearing it unconditionally at startup (nothing is in flight in a fresh
    process) is safe and also collects an orphan whose source file is gone.
    """
    global _sweeper_thread
    _clear_cache()
    if _sweeper_thread and _sweeper_thread.is_alive():
        return
    _sweeper_stop.clear()
    _sweeper_thread = threading.Thread(
        target=_sweeper_loop, daemon=True, name="stream-cache-sweeper"
    )
    _sweeper_thread.start()


def stop_sweeper() -> None:
    """Signal the sweeper thread to exit and stop any running ffmpeg (best-effort)."""
    _sweeper_stop.set()
    with _lock:
        _stop_proc_locked()


def _hls_status_locked() -> dict:
    status = _state["status"]
    sid = _state["sid"]
    if status == "error":
        public = "error"
    elif status == "done":
        public = "ready"
    elif _playable(sid, done=False):
        public = "playable"
    else:
        public = "running"
    return {
        "status": public,
        "progress": 100.0 if status == "done" else _state["progress"],
        "error": _state["error"],
        "mode": "hls",
        "url": f"/stream/hls/{sid}/{_MASTER}" if public in ("playable", "ready") else None,
    }


_DIRECT = {"status": "ready", "progress": 100.0, "error": None, "mode": "direct", "url": None}
_NOT_STARTED = {
    "status": "not_started",
    "progress": 0.0,
    "error": None,
    "mode": "hls",
    "url": None,
}


def needs_prepare(video_path: str) -> dict:
    """Non-blocking status check. Does not start a run — call start_prepare() for that."""
    with _lock:
        _sweep_locked()
        if _state["path"] == video_path and _state["status"] in ("running", "done", "error"):
            _state["touched"] = time.time()
            return _hls_status_locked()

    _, audio = _probe_codecs(video_path)
    if audio is None or audio in _WEB_SAFE_AUDIO_CODECS:
        return dict(_DIRECT)
    return dict(_NOT_STARTED)


def start_prepare(video_path: str) -> dict:
    """Idempotent: starts the HLS run if one isn't already covering this file, and always
    returns the current status (same shape as needs_prepare)."""
    status = needs_prepare(video_path)
    if status["status"] != "not_started":
        return status

    video, _ = _probe_codecs(video_path)
    with _lock:
        # Re-check inside the lock in case another request just started it.
        if _state["path"] == video_path and _state["status"] in ("running", "done"):
            return _hls_status_locked()
        _stop_proc_locked()
        _clear_cache()
        sid = secrets.token_hex(4)
        os.makedirs(_session_dir(sid), exist_ok=True)
        _state.update(
            path=video_path,
            sid=sid,
            status="running",
            progress=0.0,
            error=None,
            touched=time.time(),
        )
        threading.Thread(target=_run_hls, args=(video_path, sid, video), daemon=True).start()
        return _hls_status_locked()


def _run_hls(video_path: str, sid: str, video_codec: str | None) -> None:
    """Stream-copy the video and re-encode audio to AAC stereo into fMP4 HLS segments.

    Video is copied, so the run is I/O-bound and far faster than real time — the playlist
    is playable within seconds and stays ahead of the player. The playlist is EVENT type:
    it grows until ffmpeg finishes, then ends (becoming a normal VOD).
    """
    global _proc
    out_dir = _session_dir(sid)
    duration = get_video_duration(video_path) or 0.0
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        # Explicit map: without it ffmpeg can also grab a subtitle or attachment stream
        # (fonts etc.) from the source that the mp4 muxer can't hold, failing the run.
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "copy",
        *(["-tag:v", "hvc1"] if video_codec == "hevc" else []),
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        str(_SEGMENT_SECONDS),
        "-hls_playlist_type",
        "event",
        "-hls_list_size",
        "0",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        _INIT,
        "-hls_flags",
        "independent_segments+temp_file",
        "-hls_segment_filename",
        os.path.join(out_dir, "seg_%05d.m4s"),
        "-progress",
        "pipe:1",
        "-nostats",
        os.path.join(out_dir, _PLAYLIST),
    ]

    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="stream_hls_")
    try:
        with _lock:
            if _state["sid"] != sid:
                return  # superseded before ffmpeg even started
            _proc = proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err_fd, text=True)
        os.close(err_fd)
        err_fd = -1

        master_ready = False
        for line in iter(proc.stdout.readline, ""):
            line = line.strip()
            if not master_ready:
                master_ready = _write_master(sid)
            if line.startswith("out_time_ms=") and duration > 0:
                try:
                    ms = int(line.split("=", 1)[1])
                    with _lock:
                        if _state["sid"] == sid:
                            _state["progress"] = min(99.0, ms / 1_000_000 / duration * 100)
                except ValueError:
                    pass

        ret = proc.wait()
        with _lock:
            if _state["sid"] != sid or _state["status"] == "stopped":
                return  # killed on purpose (superseded or stalled) — not a failure
        if ret != 0:
            with open(err_path, errors="replace") as fh:
                stderr = fh.read()[-2000:]
            raise RuntimeError(f"ffmpeg exit {ret}: {stderr}")
        if not _write_master(sid):
            raise RuntimeError("Unsupported video codec for streaming")
        with _lock:
            if _state["sid"] == sid:
                _state.update(status="done", progress=100.0, error=None)
    except Exception as exc:
        logger.warning("Stream HLS failed for %s: %s", video_path, exc)
        with _lock:
            if _state["sid"] == sid:
                _state.update(status="error", error=str(exc)[:1000])
    finally:
        if err_fd != -1:
            os.close(err_fd)
        try:
            os.remove(err_path)
        except OSError:
            pass


def read_playlist(path: str) -> bytes:
    """One consistent read of the media playlist, cut back to its last complete entry.

    ffmpeg appends to `index.m3u8` in place while it runs, so streaming the file straight
    off disk can send a stale Content-Length or a half-written line.
    """
    with open(path, "rb") as fh:
        lines = fh.read().decode(errors="replace").split("\n")
    lines.pop()  # whatever follows the final newline is empty or a partial line
    while lines and lines[-1].startswith("#EXTINF"):
        lines.pop()  # a duration whose segment name hasn't landed yet
    return ("\n".join(lines) + "\n").encode()


def hls_file_path(sid: str, name: str) -> str | None:
    """Path of a file in the current session's directory, or None if it isn't servable.

    Only the live session's id is accepted, and `name` must be a plain playlist/segment
    filename — no path separators — so requests can't reach outside the session directory.
    """
    if not _SID_RE.fullmatch(sid) or not _NAME_RE.fullmatch(name):
        return None
    with _lock:
        if _state["sid"] != sid:
            return None
        _state["touched"] = time.time()
    path = os.path.join(_session_dir(sid), name)
    return path if os.path.isfile(path) else None
