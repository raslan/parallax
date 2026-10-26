"""Downloader-neutral helpers shared by the yt-dlp and gallery-dl features.

Neither feature imports from the other; both import from here. Extract only
genuinely portable, stable-surface mechanism — parametrize what differs.
"""

import asyncio
import logging
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import urllib.request
import zipfile
from collections.abc import Callable, Sequence

logger = logging.getLogger(__name__)


class ResizableSemaphore:
    """asyncio.Semaphore whose concurrency limit can change at runtime.

    Growing releases extra permits immediately. Shrinking swallows any
    currently-idle permits right away and marks the rest as "pending" so
    they're removed the next time an in-flight holder releases.
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


def install_binary(url: str, dest: str) -> None:
    """Download a standalone binary to *dest*, atomically. Blocking."""
    tmp = dest + ".tmp"
    try:
        urllib.request.urlretrieve(url, tmp)  # noqa: S310 - trusted GitHub release URL
        os.chmod(tmp, 0o755)
        os.replace(tmp, dest)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def install_zip_binary(url: str, member: str, dest: str) -> None:
    """Download a zip and extract its single executable *member* to *dest*, atomically.

    For releases that ship the binary inside an archive (deno). Blocking.
    """
    zip_tmp, tmp = dest + ".zip.tmp", dest + ".tmp"
    try:
        urllib.request.urlretrieve(url, zip_tmp)  # noqa: S310 - trusted GitHub release URL
        with zipfile.ZipFile(zip_tmp) as zf, zf.open(member) as src, open(tmp, "wb") as out:
            shutil.copyfileobj(src, out)
        os.chmod(tmp, 0o755)
        os.replace(tmp, dest)
    finally:
        for leftover in (zip_tmp, tmp):
            if os.path.exists(leftover):
                os.remove(leftover)


def probe_version(path: str, args: Sequence[str] = ("--version",)) -> str | None:
    """Return stripped stdout of `path --version` (rc 0), else None. Blocking."""
    try:
        result = subprocess.run([path, *args], capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def resolve_binary(dest: str, path_name: str) -> str | None:
    """Data-volume path first, then PATH fallback."""
    if os.path.isfile(dest) and os.access(dest, os.X_OK):
        return dest
    return shutil.which(path_name)


def cookies_to_tempfile(text: str) -> str | None:
    """Write Netscape-cookie text to a temp file; None if text is blank.

    Caller owns the file's lifecycle (delete in a finally block).
    """
    if not text or not text.strip():
        return None
    fd, path = tempfile.mkstemp(prefix="parallax_cookies_", suffix=".txt")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
    except OSError:
        try:
            os.remove(path)
        except OSError:
            pass
        return None
    return path


def _kill_group(proc: subprocess.Popen, sig: int) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), sig)
    except (ProcessLookupError, OSError):
        try:
            proc.send_signal(sig)
        except (ProcessLookupError, OSError):
            pass


class ProcessGroup:
    """Registry of live subprocesses keyed by an int, with cancellation.

    One instance per downloader. `cancel`'s signal is parametrized:
    yt-dlp passes SIGKILL; gallery-dl passes SIGINT + a SIGKILL escalation.
    """

    def __init__(self) -> None:
        self._procs: dict[int, subprocess.Popen] = {}
        self._lock = threading.Lock()
        self._cancel_requested: set[int] = set()
        self._cancelled: set[int] = set()

    def register(self, key: int, proc: subprocess.Popen) -> None:
        with self._lock:
            self._procs[key] = proc

    def unregister(self, key: int) -> None:
        with self._lock:
            self._procs.pop(key, None)

    def peek(self, key: int) -> subprocess.Popen | None:
        with self._lock:
            return self._procs.get(key)

    def request_cancel(self, key: int) -> None:
        self._cancel_requested.add(key)

    def is_cancel_requested(self, key: int) -> bool:
        return key in self._cancel_requested

    def is_cancelled(self, key: int) -> bool:
        return key in self._cancelled

    def discard(self, key: int) -> None:
        self._cancel_requested.discard(key)
        self._cancelled.discard(key)

    def clear_cancel_requested(self, key: int) -> None:
        """Drop only the cancel-requested flag, keeping any `_cancelled` mark."""
        self._cancel_requested.discard(key)

    def cancel(
        self,
        key: int,
        *,
        sig: int = signal.SIGKILL,
        escalate_after: float | None = None,
        on_escalated: Callable[[int], None] | None = None,
    ) -> bool:
        self._cancel_requested.add(key)
        with self._lock:
            proc = self._procs.get(key)
            if proc is None:
                return False
            self._cancelled.add(key)
            _kill_group(proc, sig)
        if escalate_after is not None:
            threading.Thread(
                target=self._escalate,
                args=(key, proc, escalate_after, on_escalated),
                daemon=True,
            ).start()
        return True

    def _escalate(
        self,
        key: int,
        proc: subprocess.Popen,
        delay: float,
        on_escalated: Callable[[int], None] | None,
    ) -> None:
        try:
            proc.wait(timeout=delay)
            return  # died on its own from the first signal
        except subprocess.TimeoutExpired:
            _kill_group(proc, signal.SIGKILL)
        if on_escalated is not None:
            try:
                on_escalated(key)
            except Exception:
                logger.exception("on_escalated callback failed for key %s", key)


# yt-dlp quality/codec -> `-f` selector. Shared by Downloads and Galleries' ytdl backend.
CODEC_VCODEC: dict[str, str] = {
    "h264": "avc",
    "hevc": "hev",  # matches hev1, hevc; hvc1 handled via fallback
    "av1": "av01",
    "vp9": "vp9",
}
CODEC_CONTAINER: dict[str, str] = {
    "h264": "mp4",
    "hevc": "mp4",
    "av1": "webm",
    "vp9": "webm",
    "auto": "mkv",
}
AUDIO_CONTAINERS = {"mp3", "m4a", "opus", "flac", "wav"}


def format_sort(quality: str) -> str | None:
    """`-S` value that caps the video's *short* side at `quality` px, or None for "best".

    yt-dlp's `res` sort field is the smallest dimension, so 1080 means 1920x1080 landscape and
    1080x1920 portrait alike. A `[height<=N]` filter would cap the height instead and silently
    drop a 1080-wide vertical video to ~480p. Sorting (not filtering) means a source with
    nothing at or under N still downloads its smallest stream rather than failing.
    """
    return f"res:{quality}" if quality != "best" else None


def format_selector(quality: str, codec: str) -> tuple[str, str]:
    """Return (format_string, merge_container) for a codec preference.

    Resolution is *not* part of the selector — pair it with `format_sort(quality)` (`-S`).
    `quality` is accepted so callers keep one call shape.
    """
    del quality  # applied via -S, see format_sort
    vc = CODEC_VCODEC.get(codec, "")
    container = CODEC_CONTAINER.get(codec, "mkv")

    # Fallback chain priority: preferred codec → any codec → combined stream.
    # Codec degrades gracefully; the resolution cap lives in the sort order, not here.
    any_codec = "bestvideo+bestaudio"
    combined = "best"  # last resort: pre-muxed stream

    if not vc:  # auto
        fmt = f"{any_codec}/{combined}"
    elif codec == "hevc":
        # HEVC streams tagged as hev1/hevc or hvc1 — try both naming conventions
        fmt = (
            f"bestvideo[vcodec*={vc}]+bestaudio"
            f"/bestvideo[vcodec*=hvc]+bestaudio"
            f"/{any_codec}/{combined}"
        )
    else:
        fmt = f"bestvideo[vcodec*={vc}]+bestaudio/{any_codec}/{combined}"

    return fmt, container


def parse_impersonate_targets(stdout: str) -> list[str]:
    """Targets from `yt-dlp --list-impersonate-targets` output.

    Skips the `[info]`/header/rule lines and any row marked `(unavailable)` — the pip module
    lists every client even when curl_cffi isn't installed, and picking one would fail the run.
    """
    targets: list[str] = []
    for line in stdout.splitlines():
        s = line.strip()
        if (
            not s
            or s.startswith(("[", "Available", "Client", "Target"))
            or set(s) <= {"-", "─"}
            or "(unavailable)" in s
        ):
            continue
        client = s.split()[0]
        if client not in targets:  # one row per client+OS; a bare client name is a valid target
            targets.append(client)
    return targets
