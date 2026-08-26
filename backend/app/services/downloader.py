"""yt-dlp download service.

Manages yt-dlp subprocesses for downloading videos.  All blocking I/O
runs in a thread via asyncio.to_thread so the FastAPI event loop stays
responsive.
"""

import asyncio
import json
import os
import re
import select
import shlex
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

from app.config import DATA_DIR
from app.database import SessionLocal
from app.models.download import Download, DownloadStatus
from app.services.common import now

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_active_procs: dict[int, subprocess.Popen] = {}  # download_id → process
_active_procs_lock = threading.Lock()
_STALL_TIMEOUT = 300  # seconds of zero stdout output before a subprocess is considered hung
_cancelled_ids: set[int] = set()  # cancelled and process killed
_cancel_requested: set[int] = set()  # cancel requested (may not have proc yet)


class _ResizableSemaphore:
    """asyncio.Semaphore whose concurrency limit can change at runtime.

    Growing releases extra permits immediately. Shrinking swallows any
    currently-idle permits right away and marks the rest as "pending" so
    they're removed the next time an in-flight download finishes and
    releases, instead of going back into the pool.
    """

    def __init__(self, value: int) -> None:
        self._sem = asyncio.Semaphore(value)
        self._limit = value
        self._pending_shrink = 0

    def resize(self, new_limit: int) -> None:
        new_limit = max(1, new_limit)
        diff = new_limit - self._limit
        self._limit = new_limit
        if diff > 0:
            for _ in range(diff):
                self._sem.release()
        elif diff < 0:
            to_remove = -diff
            while to_remove > 0 and self._sem._value > 0:
                self._sem._value -= 1
                to_remove -= 1
            self._pending_shrink += to_remove

    async def __aenter__(self) -> None:
        await self._sem.acquire()

    async def __aexit__(self, *exc) -> None:
        if self._pending_shrink > 0:
            self._pending_shrink -= 1
        else:
            self._sem.release()


_download_semaphore: _ResizableSemaphore | None = None
_semaphore_limit: int = 0

# ---------------------------------------------------------------------------
# yt-dlp management
# ---------------------------------------------------------------------------


def _ytdlp_bin() -> str | None:
    """Return path to yt-dlp binary: data-volume location first, then PATH fallback."""
    if os.path.isfile(_YTDLP_BIN) and os.access(_YTDLP_BIN, os.X_OK):
        return _YTDLP_BIN
    import shutil

    return shutil.which("yt-dlp")


def get_ytdlp_info() -> dict:
    """Return {"installed": bool, "version": str | None, "path": str | None}."""
    path = _ytdlp_bin()
    if path is None:
        return {"installed": False, "version": None, "path": None}
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        version = result.stdout.strip() if result.returncode == 0 else None
        return {"installed": True, "version": version, "path": path}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"installed": False, "version": None, "path": None}


_YTDLP_BIN = os.path.join(DATA_DIR, "yt-dlp")  # stored in data volume, writable by container user
_YTDLP_URLS = {
    "stable": "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
    "nightly": "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux",
}


def install_ytdlp(channel: str = "stable") -> None:
    """Download latest yt-dlp standalone binary from GitHub releases.

    The binary bundles all dependencies including curl-cffi.
    Blocking — callers must wrap in asyncio.to_thread if called from async context.
    """
    url = _YTDLP_URLS.get(channel, _YTDLP_URLS["stable"])
    tmp = _YTDLP_BIN + ".tmp"
    try:
        urllib.request.urlretrieve(url, tmp)
        os.chmod(tmp, 0o755)
        os.replace(tmp, _YTDLP_BIN)  # atomic replace
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


# ---------------------------------------------------------------------------
# Command builder
# ---------------------------------------------------------------------------


_CODEC_VCODEC: dict[str, str] = {
    "h264": "avc",
    "hevc": "hev",  # matches hev1, hevc; hvc1 handled via fallback
    "av1": "av01",
    "vp9": "vp9",
}
_CODEC_CONTAINER: dict[str, str] = {
    "h264": "mp4",
    "hevc": "mp4",
    "av1": "webm",
    "vp9": "webm",
    "auto": "mkv",
}
_AUDIO_CONTAINERS = {"mp3", "m4a", "opus", "flac", "wav"}


def _format_selector(quality: str, codec: str) -> tuple[str, str]:
    """Return (format_string, merge_container) for a quality+codec combination."""
    h = f"[height<={quality}]" if quality != "best" else ""
    vc = _CODEC_VCODEC.get(codec, "")
    container = _CODEC_CONTAINER.get(codec, "mkv")

    # Fallback chain priority: preferred codec → any codec (quality preserved) → combined stream
    # This ensures quality is never sacrificed — codec degrades gracefully instead.
    any_at_quality = f"bestvideo{h}+bestaudio"  # no codec filter, respects height limit
    combined = f"best{h}"  # last resort: pre-muxed stream

    if not vc:  # auto
        fmt = f"{any_at_quality}/{combined}"
    elif codec == "hevc":
        # HEVC streams tagged as hev1/hevc or hvc1 — try both naming conventions
        fmt = (
            f"bestvideo{h}[vcodec*={vc}]+bestaudio"
            f"/bestvideo{h}[vcodec*=hvc]+bestaudio"
            f"/{any_at_quality}/{combined}"
        )
    else:
        fmt = f"bestvideo{h}[vcodec*={vc}]+bestaudio/{any_at_quality}/{combined}"

    return fmt, container


def build_ytdlp_cmd(url: str, output_dir: str, options: dict) -> list[str]:
    """Build yt-dlp command list from options dict.

    options keys (all optional):
      audio_only: bool
      quality: "best"|"2160"|"1440"|"1080"|"720"|"480"|"360"
      codec: "auto"|"h264"|"hevc"|"av1"|"vp9" (video) or audio container for audio_only
      trim_start: "00:01:30"
      trim_end: "00:05:00"
      download_subs: bool
      sub_langs: "en,fr"
      extra_args: str
      impersonate: str
      cookies_file: str — path to temp cookies file (caller manages lifecycle)
    """
    audio_only: bool = bool(options.get("audio_only", False))
    quality: str = options.get("quality", "best") or "best"
    codec: str = options.get("codec", "auto") or "auto"
    trim_start: str | None = options.get("trim_start") or None
    trim_end: str | None = options.get("trim_end") or None
    download_subs: bool = bool(options.get("download_subs", False))
    sub_langs: str = options.get("sub_langs") or "en"
    extra_args_str: str = options.get("extra_args") or ""
    impersonate: str | None = options.get("impersonate") or None
    cookies_file: str | None = options.get("cookies_file") or None

    cmd: list[str] = [_ytdlp_bin() or "yt-dlp"]

    # Always-on flags
    cmd += ["--progress", "--newline", "--no-warnings", "--concurrent-fragments", "4"]

    # Output template
    # _output_title_override is injected by _run_download_sync for collision avoidance
    output_title = options.get("_output_title_override") or "%(title)s"
    cmd += ["-o", f"{output_dir}/{output_title}.%(ext)s"]

    # Format / quality selection
    if audio_only:
        # codec field reused as audio container when audio_only=True
        audio_fmt = codec if codec in _AUDIO_CONTAINERS else "mp3"
        cmd += ["-x", "--audio-format", audio_fmt]
    else:
        fmt, container = _format_selector(quality, codec)
        cmd += ["-f", fmt, "--merge-output-format", container]

    # Trim / sections
    if trim_start or trim_end:
        start = trim_start or "0"
        end = trim_end or "inf"
        cmd += ["--download-sections", f"*{start}-{end}"]

    # Subtitles
    if download_subs:
        cmd += ["--write-subs", "--write-auto-subs", "--sub-langs", sub_langs]

    # Cookies
    if cookies_file and os.path.isfile(cookies_file):
        cmd += ["--cookies", cookies_file]

    # Impersonation
    if impersonate:
        cmd += ["--impersonate", impersonate]

    # Extra user-supplied arguments
    if extra_args_str.strip():
        try:
            cmd += shlex.split(extra_args_str)
        except ValueError:
            cmd.append(extra_args_str)

    cmd.append(url)
    return cmd


def list_impersonate_targets() -> list[str]:
    """Return available impersonate target names from the installed yt-dlp binary.

    Blocking — callers must wrap in asyncio.to_thread if called from async context.
    """
    bin_path = _ytdlp_bin()
    if not bin_path:
        return []
    try:
        result = subprocess.run(
            [bin_path, "--list-impersonate-targets"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        targets = []
        for line in result.stdout.splitlines():
            # Each line: "  chrome-131      curl_cffi"
            stripped = line.strip()
            if (
                not stripped
                or stripped.startswith("Available")
                or stripped.startswith("Target")
                or set(stripped) <= {"-", "─"}
            ):
                continue
            target = stripped.split()[0]
            targets.append(target)
        return targets
    except Exception:
        return []


def _safe_dirname(name: str) -> str:
    """Sanitize a string for use as a filesystem directory name."""
    import unicodedata

    name = unicodedata.normalize("NFC", name)
    for ch in r'\/:*?"<>|':
        name = name.replace(ch, "_")
    name = name.strip(". ")
    return name[:100] or "playlist"


def unique_playlist_dir(output_dir: str, title: str) -> str:
    """Return a non-colliding playlist directory path under output_dir for *title*.

    Sites that don't expose a playlist title (flat-playlist dump has no
    "title"/"uploader") all fall back to the same generic "playlist" name via
    _safe_dirname — without this, two unrelated playlists would land in and
    mix files in the same folder.
    """
    safe = _safe_dirname(title)
    candidate = os.path.join(output_dir, safe)
    if not os.path.exists(candidate):
        return candidate
    n = 2
    while True:
        numbered = os.path.join(output_dir, f"{safe} ({n})")
        if not os.path.exists(numbered):
            return numbered
        n += 1


def fetch_playlist_info(url: str) -> dict | None:
    """Probe *url* to determine if it's a playlist.

    Returns a dict with keys:
      playlist_id: str
      playlist_title: str
      entries: list[{"url": str, "title": str | None, "index": int}]

    Returns None if the URL is not a playlist, or on any error.
    Blocking — wrap in asyncio.to_thread.
    """
    bin_path = _ytdlp_bin()
    if not bin_path:
        return None
    try:
        result = subprocess.run(
            [bin_path, "--dump-single-json", "--flat-playlist", "--no-warnings", url],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return None
    except Exception:
        return None

    if result.returncode != 0 or not result.stdout.strip():
        return None

    try:
        data = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return None

    if data.get("_type") != "playlist":
        return None

    entries_raw = data.get("entries") or []
    entries = []
    for i, entry in enumerate(entries_raw):
        if not entry:
            continue
        video_url = entry.get("url") or entry.get("webpage_url")
        if not video_url:
            continue
        entries.append(
            {
                "url": video_url,
                "title": entry.get("title"),
                "index": i + 1,
            }
        )

    if not entries:
        return None

    return {
        "playlist_id": data.get("id") or data.get("webpage_url") or url,
        "playlist_title": data.get("title") or data.get("uploader") or "playlist",
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# Semaphore helper
# ---------------------------------------------------------------------------


def get_semaphore(max_concurrent: int) -> _ResizableSemaphore:
    """Return the module-level download semaphore, creating it on first call.

    If called with a different limit than currently active, resizes it live.
    """
    global _download_semaphore, _semaphore_limit
    if _download_semaphore is None:
        _download_semaphore = _ResizableSemaphore(max_concurrent)
        _semaphore_limit = max_concurrent
    elif max_concurrent != _semaphore_limit:
        _download_semaphore.resize(max_concurrent)
        _semaphore_limit = max_concurrent
    return _download_semaphore


def set_max_concurrent(max_concurrent: int) -> None:
    """Apply a new concurrency limit immediately, even with no download in flight."""
    get_semaphore(max_concurrent)


# ---------------------------------------------------------------------------
# Progress parsing helpers
# ---------------------------------------------------------------------------

_PROGRESS_RE = re.compile(r"\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)")
_DESTINATION_RE = re.compile(
    r"\[(?:download|ExtractAudio|ffmpeg|Merger|MoveFiles)\] Destination: (.+)$"
)
_MERGER_RE = re.compile(r'Merging formats into "(.+)"')
_FFMPEG_TIME_RE = re.compile(r"\btime=(\d+:\d+:\d+\.\d+)")


def _parse_progress(line: str) -> tuple[float, str, str] | None:
    """Return (pct, speed, eta) if line is a yt-dlp progress line, else None."""
    m = _PROGRESS_RE.search(line)
    if m:
        return float(m.group(1)), m.group(2), m.group(3)
    return None


def _hhmmss_to_seconds(ts: str) -> float:
    """Convert HH:MM:SS.ss or MM:SS or raw seconds string to float seconds."""
    try:
        parts = ts.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(ts)
    except (ValueError, IndexError):
        return 0.0


def _parse_output_path(line: str) -> str | None:
    """Return output file path from destination/merger lines, else None."""
    m = _DESTINATION_RE.search(line)
    if m:
        return m.group(1).strip()
    m = _MERGER_RE.search(line)
    if m:
        return m.group(1).strip()
    return None


# ---------------------------------------------------------------------------
# Collision-free output title
# ---------------------------------------------------------------------------


def _unique_output_title(output_dir: str, title: str | None) -> str | None:
    """Return title (possibly with ` (N)` suffix) if a file with that title already exists."""
    import unicodedata

    if not title or not output_dir or not os.path.isdir(output_dir):
        return title
    try:
        existing = os.listdir(output_dir)
    except OSError:
        return title

    def _sanitize(s: str) -> str:
        return unicodedata.normalize("NFC", s).replace("/", "_").strip()

    def _collides(candidate: str) -> bool:
        sc = _sanitize(candidate)
        return any(
            _sanitize(f).startswith(sc + ".") or _sanitize(f).startswith(sc + " [")
            for f in existing
            if not f.endswith(".part") and not f.endswith(".ytdl")
        )

    if not _collides(title):
        return title
    n = 1
    while True:
        numbered = f"{title} ({n})"
        if not _collides(numbered):
            return numbered
        n += 1


# ---------------------------------------------------------------------------
# Part-file cleanup
# ---------------------------------------------------------------------------


def _cleanup_part_files(output_dir: str, title: str | None = None) -> None:
    """Delete yt-dlp temp files (.part, .ytdl) belonging to this download."""
    import unicodedata

    if not output_dir or not os.path.isdir(output_dir):
        return
    prefix = (
        unicodedata.normalize("NFC", title).replace("/", "_").replace("\x00", "").strip()
        if title
        else None
    )
    try:
        for fname in os.listdir(output_dir):
            if not (fname.endswith(".part") or fname.endswith(".ytdl")):
                continue
            if prefix:
                rest = unicodedata.normalize("NFC", fname)[len(prefix) :]
                if not (rest.startswith(".") or rest.startswith(" [")):
                    continue
            try:
                os.remove(os.path.join(output_dir, fname))
            except OSError:
                pass
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Blocking download worker (runs in thread)
# ---------------------------------------------------------------------------


def _run_download_sync(download_id: int) -> None:
    """Blocking download worker. Intended to be called via asyncio.to_thread."""
    download: Download | None = None
    cookies_tmp: str | None = None
    db = SessionLocal()
    try:
        download = db.get(Download, download_id)
        if download is None:
            return

        # Mark running
        download.status = DownloadStatus.RUNNING
        download.started_at = now()
        db.commit()

        # Build command — write cookies to temp file if provided
        options = json.loads(download.options or "{}")

        raw_cookies: str = options.pop("cookies", "") or ""
        if raw_cookies.strip():
            fd, cookies_tmp = tempfile.mkstemp(prefix="parallax_cookies_", suffix=".txt")
            try:
                with os.fdopen(fd, "w") as f:
                    f.write(raw_cookies)
            except Exception:
                cookies_tmp = None
            else:
                options["cookies_file"] = cookies_tmp

        # Prefetch metadata (best-effort — don't fail if this errors)
        try:
            meta_cmd = [_ytdlp_bin() or "yt-dlp", "--dump-json", "--no-playlist"]
            if cookies_tmp and os.path.isfile(cookies_tmp):
                meta_cmd += ["--cookies", cookies_tmp]
            meta_cmd.append(download.url)
            meta_result = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=30)
            if meta_result.returncode == 0 and meta_result.stdout.strip():
                meta = json.loads(meta_result.stdout.strip().splitlines()[0])
                download.title = meta.get("title") or meta.get("fulltitle")
                download.uploader = meta.get("uploader") or meta.get("channel")
                download.thumbnail_url = meta.get("thumbnail")
                download.duration = meta.get("duration")
                db.commit()
        except Exception:
            pass  # metadata prefetch failure is non-fatal

        # Compute trim duration for ffmpeg progress estimation (trim_end - trim_start in seconds)
        trim_duration_s: float | None = None
        try:
            ts = options.get("trim_start") or "0"
            te = options.get("trim_end")
            if te and te != "inf":
                trim_duration_s = _hhmmss_to_seconds(te) - _hhmmss_to_seconds(ts)
                if trim_duration_s <= 0:
                    trim_duration_s = None
        except Exception:
            pass
        # Inject collision-free title so duplicate-URL titles get (1), (2) suffixes
        unique_title = _unique_output_title(download.output_dir, download.title)
        if unique_title and unique_title != download.title:
            options["_output_title_override"] = unique_title
        elif download.title:
            options["_output_title_override"] = download.title
        try:
            cmd = build_ytdlp_cmd(download.url, download.output_dir, options)
        except Exception as exc:
            download.status = DownloadStatus.FAILED
            download.error = f"Failed to build yt-dlp command: {exc}"
            download.finished_at = now()
            db.commit()
            return

        # Bail out early if cancel was requested before subprocess started
        if download_id in _cancel_requested:
            _cancel_requested.discard(download_id)
            _cancelled_ids.add(download_id)
            download.status = DownloadStatus.CANCELLED
            download.finished_at = now()
            db.commit()
            return

        _MAX_ATTEMPTS = 3
        _RETRY_DELAYS = [5, 15, 30]  # seconds between attempts
        # Error patterns that indicate a permanent failure — don't retry these
        _NO_RETRY_PATTERNS = [
            "video unavailable",
            "private video",
            "has been removed",
            "not found",
            "does not exist",
            "no such file",
            "unable to extract",
            "unsupported url",
        ]

        ytdlp_version = get_ytdlp_info().get("version") or "unknown"
        last_error: str = ""
        succeeded = False
        output_path: str | None = None

        for attempt in range(_MAX_ATTEMPTS):
            if download_id in _cancel_requested:
                break

            if attempt > 0:
                delay = _RETRY_DELAYS[attempt - 1]
                attempt_str = f"Attempt {attempt}/{_MAX_ATTEMPTS - 1}"
                download.error = f"{attempt_str} failed, retrying in {delay}s…\n\n{last_error}"
                db.commit()
                time.sleep(delay)
                if download_id in _cancel_requested:
                    break
                download.progress = 0.0
                download.speed = None
                download.eta = None
                db.commit()

            # Start subprocess
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    start_new_session=True,
                )
            except FileNotFoundError:
                download.status = DownloadStatus.FAILED
                download.error = "yt-dlp not found. Go to Settings → Downloads and click Install."
                download.finished_at = now()
                db.commit()
                return

            with _active_procs_lock:
                _active_procs[download_id] = proc

            last_pct: float = -1.0
            output_lines: list[str] = []
            stalled = False

            try:
                if proc.stdout is None:
                    raise RuntimeError("subprocess stdout is None")

                last_output_time = time.time()
                while True:
                    ready, _, _ = select.select([proc.stdout], [], [], 5.0)
                    if not ready:
                        if time.time() - last_output_time > _STALL_TIMEOUT:
                            stalled = True
                            msg = (
                                f"[parallax] no output for {_STALL_TIMEOUT}s — "
                                "killing stalled process"
                            )
                            output_lines.append(msg)
                            try:
                                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                            except (ProcessLookupError, OSError):
                                proc.kill()
                            break
                        continue

                    line = proc.stdout.readline()
                    if line == "":
                        break  # EOF — process closed stdout
                    last_output_time = time.time()
                    line = line.rstrip("\n")
                    output_lines.append(line)

                    detected_path = _parse_output_path(line)
                    if detected_path:
                        output_path = detected_path
                        last_pct = -1.0  # new stream (video/audio/merge) — percent resets to 0

                    parsed = _parse_progress(line)
                    if parsed:
                        pct, speed, eta = parsed
                        if pct - last_pct >= 1.0:
                            download.progress = pct
                            download.speed = speed
                            download.eta = eta
                            db.commit()
                            last_pct = pct
                    elif trim_duration_s:
                        m = _FFMPEG_TIME_RE.search(line)
                        if m:
                            elapsed = _hhmmss_to_seconds(m.group(1))
                            if elapsed > 0:
                                pct = min(elapsed / trim_duration_s * 100.0, 99.0)
                                if pct - last_pct >= 1.0:
                                    download.progress = pct
                                    db.commit()
                                    last_pct = pct

                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)

            finally:
                with _active_procs_lock:
                    _active_procs.pop(download_id, None)

            _cancel_requested.discard(download_id)

            if proc.returncode == 0 and not stalled:
                succeeded = True
                break

            if download_id in _cancelled_ids or download_id in _cancel_requested:
                break

            tail = "\n".join(line for line in output_lines[-20:] if line.strip())
            last_error = f"[yt-dlp {ytdlp_version}] exited with code {proc.returncode}\n\n{tail}"

            # Don't retry permanent errors
            tail_lower = tail.lower()
            if any(pat in tail_lower for pat in _NO_RETRY_PATTERNS):
                break

        # Determine final status
        if succeeded:
            download.status = DownloadStatus.COMPLETED
            download.progress = 100.0
            download.finished_at = now()
            if output_path:
                download.output_path = output_path
        elif download_id in _cancelled_ids or download_id in _cancel_requested:
            _cancelled_ids.discard(download_id)
            _cancel_requested.discard(download_id)
            download.status = DownloadStatus.CANCELLED
            download.finished_at = now()
            _cleanup_part_files(download.output_dir, download.title)
        else:
            download.status = DownloadStatus.FAILED
            download.error = last_error
            download.finished_at = now()
            _cleanup_part_files(download.output_dir, download.title)

        db.commit()

    except Exception as exc:
        if download is not None:
            try:
                download.status = DownloadStatus.FAILED
                download.error = str(exc)
                download.finished_at = now()
                db.commit()
            except Exception:
                pass
    finally:
        db.close()
        if cookies_tmp and os.path.exists(cookies_tmp):
            try:
                os.remove(cookies_tmp)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Async entry point
# ---------------------------------------------------------------------------


async def run_download(download_id: int, max_concurrent: int = 2) -> None:
    """Main download coroutine. Acquire semaphore then run blocking worker in thread."""
    sem = get_semaphore(max_concurrent)
    async with sem:
        await asyncio.to_thread(_run_download_sync, download_id)


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def cancel_download(download_id: int) -> bool:
    """Signal cancellation and kill active subprocess + its entire process group."""
    # Always mark as cancel-requested so pre-subprocess phase also stops
    _cancel_requested.add(download_id)
    with _active_procs_lock:
        proc = _active_procs.get(download_id)
        if proc:
            _cancelled_ids.add(download_id)
            try:
                # Kill the whole process group to take down yt-dlp + ffmpeg children
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                proc.kill()  # fallback if process group unavailable
            return True
    return False
