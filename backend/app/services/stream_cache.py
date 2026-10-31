"""On-demand HLS for files whose audio the browser can't decode (AC3/DTS/TrueHD, ...).

The video is stream-copied and the audio re-encoded to AAC stereo. The full VOD playlist is
built up front from the file's keyframes (`keyframes.py`, `hls_plan.py`), so the player sees the
real duration and can seek anywhere. Segments are produced on request: one ffmpeg run converts one
plan chunk (`CHUNK_SEGMENTS` segments) and stops; a request outside the running chunk restarts
ffmpeg at that chunk (the same restart-on-seek model Jellyfin uses). Single slot: one session at a
time under `DATA_DIR/stream-cache/<sid>/`, wiped on boot and after an hour idle.
"""

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
from app.services import hls_plan, keyframes

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(DATA_DIR, "stream-cache")
_IDLE_TTL_SECONDS = 3600
# A run nobody has requested a segment from in this long (modal closed) is killed.
_STALL_SECONDS = 300
# How long a segment request waits for ffmpeg to produce it.
_SEGMENT_TIMEOUT_SECONDS = 30
# Chain straight into the next chunk while the player is this close to it.
_LOOKAHEAD_SEGMENTS = hls_plan.CHUNK_SEGMENTS * 2
# ffmpeg's `-ss` lands on the keyframe *before* the target unless it is aimed a little past the
# keyframe's presentation time (B-frame reorder delay); 0.2 s lands on it for every file tried.
_SEEK_MARGIN_SECONDS = 0.2
_POLL_SECONDS = 0.05

# Codecs browsers can decode natively in an HTML5 <video> element — anything
# else (AC3/DTS/TrueHD etc, common in movie rips) plays with no audio.
_WEB_SAFE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}

_SID_RE = re.compile(r"[0-9a-f]{8}")
_SEGMENT_RE = re.compile(r"seg_(\d{5})\.m4s")
_MASTER = "master.m3u8"
_PLAYLIST = "index.m3u8"
_INIT = "init.mp4"

_lock = threading.RLock()
# status: idle | planning | ready | error | stopped
_state: dict = {
    "path": None,
    "sid": None,
    "status": "idle",
    "progress": 0.0,
    "error": None,
    "touched": 0.0,
    "plan": [],
    "playlist": None,
    "master": None,
    "run": None,
    "next_run": 0,
    "last_requested": 0,
    "video_codec": None,
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


def _segment_path(sid: str, index: int) -> str:
    return os.path.join(_session_dir(sid), f"seg_{index:05d}.m4s")


def _video_codec_string(init: bytes) -> str | None:
    """RFC 6381 codec string of the copied video track, read from its avcC/hvcC box."""
    i = init.find(b"avcC")
    if i >= 0 and len(init) >= i + 8:
        return "avc1." + init[i + 5 : i + 8].hex()
    i = init.find(b"hvcC")
    if i >= 0 and len(init) >= i + 17:
        b = init[i + 4 : i + 17]
        # general_profile_space, tier flag, profile_idc, reversed compat flags, level, constraints
        space = "ABC"[(b[1] >> 6) - 1] if b[1] >> 6 else ""
        compat = int(f"{int.from_bytes(b[2:6], 'big'):032b}"[::-1], 2)
        constraints = ".".join(f"{c:02x}" for c in b[6:12].rstrip(b"\0"))
        tier = "H" if b[1] & 0x20 else "L"
        parts = [f"hvc1.{space}{b[1] & 0x1F}", f"{compat:x}", f"{tier}{b[12]}"]
        return ".".join(parts + ([constraints] if constraints else []))
    return None


def _master_playlist(video_codec: str) -> str:
    return (
        "#EXTM3U\n"
        f'#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="{video_codec},mp4a.40.2"\n'
        f"{_PLAYLIST}\n"
    )


def _clear_cache() -> None:
    """Remove every session directory (and any pre-HLS leftovers)."""
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


# ── ffmpeg runs ───────────────────────────────────────────────────────────────


def _run_command(video_path: str, sid: str, first: int, rid: int):
    plan = _state["plan"]
    out = _session_dir(sid)
    if first == 0:
        inputs = ["-i", video_path, "-map", "0:v:0", "-map", "0:a:0"]
    else:
        # Video seeks a little past the keyframe so ffmpeg lands on it; audio gets its own
        # input seeked to the exact cut so it doesn't start late.
        start = plan[first].start
        inputs = [
            *["-ss", f"{start + _SEEK_MARGIN_SECONDS:.3f}", "-i", video_path],
            *["-ss", f"{start:.3f}", "-i", video_path],
            *["-map", "0:v:0", "-map", "1:a:0"],
        ]
    return [
        "ffmpeg",
        "-v",
        "error",
        "-nostats",
        "-y",
        *inputs,
        *["-c:v", "copy"],
        *(["-tag:v", "hvc1"] if _state["video_codec"] == "hevc" else []),
        *["-c:a", "aac", "-ac", "2"],
        *["-copyts", "-avoid_negative_ts", "disabled", "-start_at_zero"],
        *["-f", "hls", "-max_delay", "5000000"],
        *["-hls_time", f"{hls_plan.SEGMENT_SECONDS:g}", "-hls_segment_type", "fmp4"],
        *["-hls_fmp4_init_filename", f"init_{rid}.mp4", "-start_number", str(first)],
        *["-hls_segment_options", "movflags=+frag_discont+skip_sidx"],
        *["-hls_playlist_type", "vod", "-hls_list_size", "0", "-hls_flags", "temp_file"],
        *["-hls_segment_filename", os.path.join(out, "seg_%05d.m4s")],
        os.path.join(out, f"run_{rid}.m3u8"),
    ]


def _stop_run_locked() -> None:
    """Cancel the current run and terminate its ffmpeg. Caller holds _lock."""
    run = _state["run"]
    if run is None:
        return
    run["cancelled"] = True
    proc = run["proc"]
    if proc is not None and proc.poll() is None:
        proc.terminate()


def _start_run_locked(chunk: int) -> None:
    """Start converting plan chunk `chunk`, replacing any running one. Caller holds _lock."""
    plan = _state["plan"]
    first = chunk * hls_plan.CHUNK_SEGMENTS
    last = min(first + hls_plan.CHUNK_SEGMENTS, len(plan)) - 1
    _stop_run_locked()
    rid = _state["next_run"]
    _state["next_run"] += 1
    sid, path = _state["sid"], _state["path"]
    run = {
        "rid": rid,
        "first": first,
        "last": last,
        "proc": None,
        "cancelled": False,
        "finished": False,
        "ok": False,
        "t0": time.time(),
    }
    _state["run"] = run
    cmd = _run_command(path, sid, first, rid)
    threading.Thread(target=_pump, args=(sid, run, cmd), daemon=True, name=f"hls-run-{rid}").start()


def _pump(sid: str, run: dict, cmd: list[str]) -> None:
    """Run one chunk's ffmpeg, stop it as soon as the chunk's last segment lands, then chain."""
    err_fd, err_path = tempfile.mkstemp(suffix=".log", prefix="stream_hls_")
    last_file = _segment_path(sid, run["last"])
    proc = None
    try:
        with _lock:
            if run["cancelled"] or _state["sid"] != sid:
                return
            run["proc"] = proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=err_fd)
        os.close(err_fd)
        err_fd = -1
        while proc.poll() is None and not run["cancelled"] and not os.path.exists(last_file):
            time.sleep(_POLL_SECONDS)
        if proc.poll() is None:
            proc.terminate()
        proc.wait()
        run["ok"] = os.path.exists(last_file)
        if not run["ok"] and not run["cancelled"]:
            with open(err_path, errors="replace") as fh:
                logger.warning("Stream HLS ffmpeg exit %s: %s", proc.returncode, fh.read()[-1500:])
    except Exception:
        logger.exception("Stream HLS run failed")
    finally:
        if err_fd != -1:
            os.close(err_fd)
        try:
            os.remove(err_path)
        except OSError:
            pass
        _finish_run(sid, run)


def _finish_run(sid: str, run: dict) -> None:
    out = _session_dir(sid)
    try:
        for name in os.listdir(out):
            path = os.path.join(out, name)
            m = _SEGMENT_RE.fullmatch(name)
            # Overshoot: segments past this chunk written before ffmpeg was stopped use this
            # run's anchor, not the next chunk's, so they must not be served.
            if m and int(m.group(1)) > run["last"] and os.path.getmtime(path) >= run["t0"]:
                os.remove(path)
            elif name.endswith(".tmp") or name == f"run_{run['rid']}.m3u8":
                os.remove(path)
            elif run["rid"] and name == f"init_{run['rid']}.mp4":
                os.remove(path)  # run 0's init is kept: _prepare copies it to the shared init.mp4
    except OSError:
        pass
    with _lock:
        run["finished"] = True
        if run["cancelled"] or _state["sid"] != sid or not run["ok"]:
            return
        nxt = run["last"] + 1
        plan_len = len(_state["plan"])
        if nxt >= plan_len or nxt - _state["last_requested"] > _LOOKAHEAD_SEGMENTS:
            return
        next_last = min(nxt + hls_plan.CHUNK_SEGMENTS, plan_len) - 1
        if os.path.exists(_segment_path(sid, next_last)):
            return  # already converted earlier
        if _state["run"] is run:
            _start_run_locked(nxt // hls_plan.CHUNK_SEGMENTS)


# ── session lifecycle ─────────────────────────────────────────────────────────


def _sweep_locked() -> None:
    """Kill a stalled run, then evict a finished session once idle. Caller holds _lock."""
    if not _state["sid"]:
        return
    idle = time.time() - _state["touched"]
    run = _state["run"]
    if run is not None and not run["finished"] and idle > _STALL_SECONDS:
        _stop_run_locked()
    if idle > _IDLE_TTL_SECONDS:
        _stop_run_locked()
        shutil.rmtree(_session_dir(_state["sid"]), ignore_errors=True)
        _state.update(path=None, sid=None, status="idle", plan=[], run=None)


_SWEEP_INTERVAL_SECONDS = 30
_sweeper_stop = threading.Event()
_sweeper_thread: threading.Thread | None = None


def _sweeper_loop() -> None:
    while not _sweeper_stop.wait(_SWEEP_INTERVAL_SECONDS):
        with _lock:
            _sweep_locked()


def start_sweeper() -> None:
    """Clear any leftover session on boot, then idle-sweep on a timer."""
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
        _stop_run_locked()


def _status_locked() -> dict:
    status = _state["status"]
    ready = status == "ready"
    return {
        "status": "ready" if ready else ("error" if status == "error" else "running"),
        "progress": 100.0 if ready else _state["progress"],
        "error": _state["error"],
        "mode": "hls",
        "url": f"/stream/hls/{_state['sid']}/{_MASTER}" if ready else None,
    }


_DIRECT = {"status": "ready", "progress": 100.0, "error": None, "mode": "direct", "url": None}
_NOT_STARTED = {"status": "not_started", "progress": 0.0, "error": None, "mode": "hls", "url": None}


def needs_prepare(video_path: str) -> dict:
    """Non-blocking status check. Does not start a session — call start_prepare() for that."""
    with _lock:
        _sweep_locked()
        if _state["path"] == video_path and _state["status"] in ("planning", "ready", "error"):
            _state["touched"] = time.time()
            return _status_locked()

    _, audio = _probe_codecs(video_path)
    if audio is None or audio in _WEB_SAFE_AUDIO_CODECS:
        return dict(_DIRECT)
    return dict(_NOT_STARTED)


def start_prepare(video_path: str) -> dict:
    """Idempotent: starts planning if no session covers this file, and always returns the
    current status (same shape as needs_prepare)."""
    status = needs_prepare(video_path)
    if status["status"] != "not_started":
        return status

    video, _ = _probe_codecs(video_path)
    with _lock:
        # Re-check inside the lock in case another request just started it.
        if _state["path"] == video_path and _state["status"] in ("planning", "ready"):
            return _status_locked()
        _stop_run_locked()
        _clear_cache()
        sid = secrets.token_hex(4)
        os.makedirs(_session_dir(sid), exist_ok=True)
        _state.update(
            path=video_path,
            sid=sid,
            status="planning",
            progress=0.0,
            error=None,
            touched=time.time(),
            plan=[],
            playlist=None,
            master=None,
            run=None,
            next_run=0,
            last_requested=0,
            video_codec=video,
        )
        threading.Thread(target=_prepare, args=(video_path, sid), daemon=True).start()
        return _status_locked()


def _fail(sid: str, message: str) -> None:
    with _lock:
        if _state["sid"] == sid:
            _state.update(status="error", error=message)


def _prepare(video_path: str, sid: str) -> None:
    """Plan the segments, convert the first chunk, and publish the playlists."""

    def on_progress(fraction: float) -> None:
        with _lock:
            if _state["sid"] == sid:
                _state["progress"] = fraction * 90

    try:
        found = keyframes.extract_keyframes(video_path, on_progress)
        plan = hls_plan.plan_segments(found[1], found[0]) if found else []
        if not plan:
            return _fail(sid, "Couldn't read this file's keyframes")
        with _lock:
            if _state["sid"] != sid:
                return
            _state["plan"] = plan
            _state["playlist"] = hls_plan.media_playlist(plan, _INIT, "seg_{:05d}.m4s")
            _start_run_locked(0)
            run = _state["run"]

        first_segment = _segment_path(sid, 0)
        while not os.path.exists(first_segment):
            with _lock:
                if _state["sid"] != sid or run["cancelled"]:
                    return
            if run["finished"]:
                return _fail(sid, "ffmpeg failed to convert this file")
            time.sleep(_POLL_SECONDS)

        init = os.path.join(_session_dir(sid), f"init_{run['rid']}.mp4")
        shutil.copyfile(init, os.path.join(_session_dir(sid), _INIT))
        os.remove(init)
        with open(os.path.join(_session_dir(sid), _INIT), "rb") as fh:
            codec = _video_codec_string(fh.read())
        if codec is None:
            return _fail(sid, "Unsupported video codec for streaming")
        with _lock:
            if _state["sid"] == sid:
                _state.update(master=_master_playlist(codec), status="ready", progress=100.0)
    except Exception as exc:
        logger.exception("Stream prepare failed for %s", video_path)
        _fail(sid, str(exc)[:1000])


# ── serving ───────────────────────────────────────────────────────────────────


def _get_segment(sid: str, index: int) -> str | None:
    """Path of a finished segment, converting it first if needed. None on timeout/failure."""
    deadline = time.time() + _SEGMENT_TIMEOUT_SECONDS
    path = _segment_path(sid, index)
    chunk = index // hls_plan.CHUNK_SEGMENTS
    with _lock:
        if _state["sid"] != sid or index >= len(_state["plan"]):
            return None
        _state["last_requested"] = index
    while time.time() < deadline:
        with _lock:
            if _state["sid"] != sid:
                return None
            _state["touched"] = time.time()
            if os.path.isfile(path):
                return path
            # A newer request for another part of the file means the player has moved on
            # (this one was aborted): don't let it restart ffmpeg for a chunk nobody wants.
            if _state["last_requested"] // hls_plan.CHUNK_SEGMENTS != chunk:
                return None
            run = _state["run"]
            running = run is not None and not run["finished"]
            # The next chunk follows on its own when the current run ends, so a request just
            # past a running chunk waits instead of killing it mid-segment.
            wait_for_chain = (
                running and run["last"] < index <= run["last"] + hls_plan.CHUNK_SEGMENTS
            )
            covered = running and run["first"] <= index <= run["last"]
            if not covered and not wait_for_chain:
                if run is not None and run["finished"] and not run["ok"] and not run["cancelled"]:
                    if run["first"] <= index <= run["last"]:
                        return None  # this chunk's run already failed
                _start_run_locked(index // hls_plan.CHUNK_SEGMENTS)
        time.sleep(_POLL_SECONDS)
    return None


def hls_resource(sid: str, name: str) -> tuple[str, bytes | str] | None:
    """What to send for a request under the current session: ("bytes", data) for playlists,
    ("file", path) for the init segment and media segments, or None."""
    if not _SID_RE.fullmatch(sid):
        return None
    with _lock:
        if _state["sid"] != sid or _state["status"] != "ready":
            return None
        _state["touched"] = time.time()
        master, playlist = _state["master"], _state["playlist"]
    if name == _MASTER:
        return ("bytes", master.encode())
    if name == _PLAYLIST:
        return ("bytes", playlist.encode())
    if name == _INIT:
        path = os.path.join(_session_dir(sid), _INIT)
        return ("file", path) if os.path.isfile(path) else None
    m = _SEGMENT_RE.fullmatch(name)
    if m:
        path = _get_segment(sid, int(m.group(1)))
        return ("file", path) if path else None
    return None
