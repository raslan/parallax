"""Spawned single-worker process pool with idle shutdown, shared by the inference proxies.

Heavy native runtimes (ONNX, ncnn/Vulkan) run in a separate *spawned* process so that dropping the
worker is the only thing that guarantees their memory (and any GPU context / VRAM) is released.
Used by `image_analyzer` (NudeNet) and `upscale_runtime` (ncnn); each owns its own `WorkerPool`.
"""

import multiprocessing
import threading
import time
from collections.abc import Callable
from concurrent.futures import BrokenExecutor, CancelledError, ProcessPoolExecutor, wait
from typing import Any, TypeVar

T = TypeVar("T")


class WorkerCancelled(Exception):
    """The caller cancelled while the worker was busy and the worker was terminated."""


_spawn_ctx = multiprocessing.get_context("spawn")


class WorkerPool:
    def __init__(self, idle_timeout: float = 120.0) -> None:
        self._idle_timeout = idle_timeout
        self._executor: ProcessPoolExecutor | None = None
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def _get_executor(self) -> ProcessPoolExecutor:
        with self._lock:
            if self._executor is None:
                self._executor = ProcessPoolExecutor(max_workers=1, mp_context=_spawn_ctx)
            return self._executor

    @staticmethod
    def _stop(executor: ProcessPoolExecutor) -> None:
        """Shut the executor down and terminate its worker. `shutdown(wait=False)` alone only
        queues a stop behind the call in flight, so a busy worker would keep running (and keep
        its model in memory) until that call ended."""
        processes = list((getattr(executor, "_processes", None) or {}).values())
        executor.shutdown(wait=False, cancel_futures=True)
        for p in processes:
            if p.is_alive():
                p.terminate()

    def _discard_executor(self) -> None:
        with self._lock:
            if self._executor is not None:
                self._stop(self._executor)
                self._executor = None

    def _reset_idle_timer(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._idle_timeout, self.release)
            self._timer.daemon = True
            self._timer.start()

    def release(self) -> None:
        """Terminate the worker process, freeing everything it held."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            if self._executor is not None:
                self._stop(self._executor)
                self._executor = None

    def submit_cancellable(
        self,
        fn: Callable[..., T],
        *args: Any,
        is_cancelled: Callable[[], bool],
        grace: float = 3.0,
        poll: float = 0.25,
    ) -> T:
        """Like `submit`, but a cancel request gives the call `grace` seconds to finish on its
        own; if the worker is still busy after that it is terminated (freeing its memory and any
        GPU context; the next call respawns it) and `WorkerCancelled` is raised. A worker that
        died is respawned and the call retried once, as in `submit`."""
        for attempt in (0, 1):
            future = self._get_executor().submit(fn, *args)
            cancel_seen: float | None = None
            try:
                while not wait([future], timeout=poll).done:
                    if is_cancelled():
                        cancel_seen = cancel_seen or time.monotonic()
                        if time.monotonic() - cancel_seen >= grace:
                            self.release()
                            raise WorkerCancelled()
                result = future.result()  # re-raises the worker's own exception, whatever it is
            except CancelledError:
                # another thread released this shared worker (its own cancel): treat it as ours
                raise WorkerCancelled() from None
            except BrokenExecutor:
                self._discard_executor()
                if attempt:
                    raise
                continue
            self._reset_idle_timer()
            return result
        raise AssertionError("unreachable")  # pragma: no cover

    def submit(self, fn: Callable[..., T], *args: Any) -> T:
        """Run fn(*args) in the worker; if the worker died, respawn it and retry once."""
        try:
            result = self._get_executor().submit(fn, *args).result()
        except BrokenExecutor:
            self._discard_executor()
            result = self._get_executor().submit(fn, *args).result()
        self._reset_idle_timer()  # start the idle countdown only after the call finished
        return result
