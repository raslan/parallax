"""Spawned single-worker process pool with idle shutdown, shared by the inference proxies.

Heavy native runtimes (ONNX, ncnn/Vulkan) run in a separate *spawned* process so that dropping the
worker is the only thing that guarantees their memory (and any GPU context / VRAM) is released.
Used by `image_analyzer` (NudeNet) and `upscale_runtime` (ncnn); each owns its own `WorkerPool`.
"""

import multiprocessing
import threading
from collections.abc import Callable
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor
from typing import Any, TypeVar

T = TypeVar("T")

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

    def _discard_executor(self) -> None:
        with self._lock:
            if self._executor is not None:
                self._executor.shutdown(wait=False, cancel_futures=True)
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
                self._executor.shutdown(wait=False, cancel_futures=True)
                self._executor = None

    def submit(self, fn: Callable[..., T], *args: Any) -> T:
        """Run fn(*args) in the worker; if the worker died, respawn it and retry once."""
        try:
            result = self._get_executor().submit(fn, *args).result()
        except BrokenExecutor:
            self._discard_executor()
            result = self._get_executor().submit(fn, *args).result()
        self._reset_idle_timer()  # start the idle countdown only after the call finished
        return result
