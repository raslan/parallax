"""Run a job's files one per GPU card, or one after another on the processor (RAS-127).

Copies Compress's scheduling shape: a thread pool sized to the cards, `GpuPool.acquire_any()` /
`release()` to give each file a card (capacity 1 per card, so a card never holds two files and
one file is never split across cards), and a dispatch loop that polls the cancel flag. A file
that has not started when a cancel lands is dropped (`skipped`); running files stop themselves
(`work` checks the cancel flag and raises `ItemCancelled`).

GPU failure handling, as decided for RAS-127:
  * a CUDA / device-init error (`gpu_accel.is_device_init_error`) is logged, that card is
    `mark_degraded` for the rest of the job, and the file is retried **once** on another live
    card; if no live card remains, or the retry fails too, that file runs on the **CPU**;
  * any other failure, out-of-memory included, runs that one file on the CPU and does **not**
    degrade the card (an OOM is usually load, not a broken card);
  * the card is always released in a `finally`.
Worker threads never touch the database: they send progress and log lines to the dispatching
thread through a queue, which calls the callbacks.
"""

import logging
import queue
from collections.abc import Callable
from concurrent.futures import BrokenExecutor, ThreadPoolExecutor, wait
from dataclasses import dataclass, field

from app.services import gpu_accel
from app.services.gpu_pool import GPUDevice, GpuPool

logger = logging.getLogger(__name__)


class ItemCancelled(Exception):
    """`work` stopped because the job was cancelled."""


class ItemFailed(Exception):
    """An expected, user-facing failure of one file (the message is shown on the job). Never
    retried on another device: the file itself is the problem. `result` keeps whatever the file
    had produced before it failed (a generated subtitle whose translation then failed)."""

    def __init__(self, message: str, result: dict | None = None):
        super().__init__(message)
        self.result = result or {}


@dataclass
class Outcome:
    status: str  # "done" | "failed" | "cancelled" | "skipped" (never started)
    result: dict = field(default_factory=dict)
    error: str | None = None


class Ctx:
    """What `work` gets for one attempt: where to run, and how to report."""

    def __init__(self, events: "queue.SimpleQueue", idx: int, device: str, device_index: int):
        self._events, self._idx = events, idx
        self.device, self.device_index = device, device_index

    def progress(self, frac: float) -> None:
        """Fraction of this file done, 0-100."""
        self._events.put(("progress", self._idx, frac))

    def log(self, message: str, level: str = "info") -> None:
        self._events.put(("log", message, level))


def run_items(
    items: list[dict],
    work: Callable[[int, dict, Ctx], dict],
    devices: list[GPUDevice],
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[int, float], None],
    on_log: Callable[[str, str], None],
    on_start: Callable[[int], None] | None = None,
    on_end: Callable[[int], None] | None = None,
    poll: float = 0.5,
    generic_error: str = "Something went wrong.",
) -> list[Outcome]:
    """Run `work(idx, item, ctx)` for every item; returns one `Outcome` per item, in order."""
    events: queue.SimpleQueue = queue.SimpleQueue()
    pool = GpuPool(devices, capacity=1) if devices else None
    outcomes = [Outcome("skipped") for _ in items]

    def attempt(idx: int, item: dict, device: str, index: int) -> dict:
        return work(idx, item, Ctx(events, idx, device, index))

    def execute(idx: int, item: dict) -> dict:
        if pool is None:
            return attempt(idx, item, "cpu", 0)
        held = pool.acquire_any()
        retried = False
        try:
            while held is not None:
                try:
                    return attempt(idx, item, "cuda", int(held.index))
                except (ItemCancelled, ItemFailed):
                    raise
                except Exception as e:
                    text = str(e)
                    # A native CUDA crash kills the worker process: that is a broken card, too.
                    if gpu_accel.is_device_init_error(text) or isinstance(e, BrokenExecutor):
                        events.put(
                            ("log", f"{held.label}: GPU could not start ({text[:160]})", "error")
                        )
                        pool.mark_degraded(held)
                        failed_card = held
                        held = None
                        pool.release(failed_card)
                        if not retried:
                            retried = True
                            held = pool.acquire_any(exclude=frozenset({failed_card.index}))
                            if held is not None:
                                events.put(("log", f"retrying on {held.label}", "info"))
                                continue
                        events.put(
                            ("log", "no GPU left for this file: running it on the CPU", "info")
                        )
                    else:
                        kind = "out of memory" if gpu_accel.is_oom(text) else type(e).__name__
                        msg = f"{held.label}: GPU run failed ({kind}); using the CPU for this file"
                        events.put(("log", msg, "info"))
                    break
        finally:
            if held is not None:
                pool.release(held)
        return attempt(idx, item, "cpu", 0)

    def task(idx: int, item: dict) -> Outcome:
        if is_cancelled():  # the dispatch loop has not caught up with a cancel yet
            return Outcome("skipped")
        events.put(("start", idx))
        try:
            return Outcome("done", execute(idx, item))
        except ItemCancelled:
            return Outcome("cancelled")
        except ItemFailed as e:
            return Outcome("failed", result=e.result, error=str(e))
        except Exception as e:  # a crash in a model must cost one file, not the batch
            logger.exception("item %s failed", idx)
            events.put(("log", f"{type(e).__name__}: {e}", "error"))
            return Outcome("failed", error=generic_error)
        finally:
            events.put(("end", idx))

    def drain() -> None:
        while True:
            try:
                kind, *rest = events.get_nowait()
            except queue.Empty:
                return
            if kind == "progress":
                on_progress(rest[0], rest[1])
            elif kind == "log":
                on_log(rest[0], rest[1])
            elif kind == "start" and on_start:
                on_start(rest[0])
            elif kind == "end" and on_end:
                on_end(rest[0])

    with ThreadPoolExecutor(max_workers=max(1, len(devices)), thread_name_prefix="item") as ex:
        futures = {ex.submit(task, i, it): i for i, it in enumerate(items)}
        pending = set(futures)
        while pending:
            done, pending = wait(pending, timeout=poll)
            drain()
            for f in done:
                outcomes[futures[f]] = f.result()
            if is_cancelled():
                for f in list(pending):
                    if f.cancel():  # not started: dropped
                        pending.discard(f)
        drain()
    return outcomes
