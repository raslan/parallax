"""Downloader-neutral helpers shared by the yt-dlp and gallery-dl features.

Neither feature imports from the other; both import from here. Extract only
genuinely portable, stable-surface mechanism — parametrize what differs.
"""

import asyncio
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import urllib.request
from collections.abc import Callable, Sequence


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
        proc = self.peek(key)
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
                pass
