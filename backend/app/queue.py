"""
Asyncio job queue with configurable concurrency.

Jobs are tracked by job_id so pending ones can be cancelled before they start.
A semaphore gates how many run concurrently; a single dispatcher pulls from the
queue and spawns tasks, each of which acquires the semaphore before running.
"""

import asyncio
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

_queue: asyncio.Queue | None = None
_pending: set[int] = set()
_semaphore: asyncio.Semaphore | None = None
_executor: ThreadPoolExecutor | None = None
_max_concurrent: int = 1
_loop: asyncio.AbstractEventLoop | None = None
logger = logging.getLogger(__name__)


def _get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


def init_queue(max_concurrent: int = 1) -> None:
    """Call once at startup (before start_worker) with the saved setting."""
    global _max_concurrent, _semaphore, _executor
    _max_concurrent = max_concurrent
    _semaphore = asyncio.Semaphore(max_concurrent)
    _executor = ThreadPoolExecutor(max_workers=max_concurrent, thread_name_prefix="job-worker")


def update_max_concurrent(n: int) -> None:
    """Apply a new concurrency limit at runtime. Affects jobs that haven't started yet."""
    global _max_concurrent, _executor
    _max_concurrent = n
    _executor = ThreadPoolExecutor(max_workers=n, thread_name_prefix="job-worker")


async def enqueue(job_id: int | None, fn: Callable, *args: Any) -> None:
    """Enqueue a job. Pass job_id for cancellable jobs, None for fire-and-forget."""
    if job_id is not None:
        _pending.add(job_id)
    await _get_queue().put((job_id, fn, args))


def enqueue_threadsafe(job_id: int | None, fn: Callable, *args: Any) -> None:
    """Enqueue from a non-event-loop thread (e.g. a job running inside the
    queue's own ThreadPoolExecutor that wants to chain another job). Same
    semaphore/executor as enqueue() — just scheduled onto the running loop
    from outside it instead of awaited directly."""
    if _loop is None:
        raise RuntimeError("queue worker not started")
    asyncio.run_coroutine_threadsafe(enqueue(job_id, fn, *args), _loop)


def _mark_job_crashed(job_id: int | None, exc: BaseException) -> None:
    """Safety net for a job function that raised out of its own error handling.

    Every job body is supposed to end its Job row itself, but a failure inside
    the handler (or a bug before one exists) used to vanish here, leaving the row
    RUNNING forever — which also blocks any rescan of that library. Only rows
    still PENDING/RUNNING are touched, so a job that already ended keeps its state.
    """
    if job_id is None:
        return
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import clear_cancel, now

    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is not None and job.status in (JobStatus.PENDING, JobStatus.RUNNING):
            job.status = JobStatus.FAILED
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = now()
            db.commit()
        clear_cancel(job_id)
    except Exception:
        logger.exception("could not mark crashed job %s failed", job_id)
    finally:
        db.close()


def cancel_pending(job_id: int) -> bool:
    """Remove a queued-but-not-started job. Returns True if it was pending."""
    if job_id in _pending:
        _pending.discard(job_id)
        return True
    return False


async def start_worker() -> None:
    global _loop
    if _semaphore is None:
        init_queue(_max_concurrent)

    loop = asyncio.get_event_loop()
    _loop = loop
    q = _get_queue()

    async def _run(job_id: int | None, fn: Callable, args: tuple) -> None:
        async with _semaphore:
            try:
                await loop.run_in_executor(_executor, fn, *args)
            except Exception as exc:
                logger.exception("job %s (%s) crashed", job_id, getattr(fn, "__name__", fn))
                await loop.run_in_executor(None, _mark_job_crashed, job_id, exc)

    async def _dispatcher() -> None:
        while True:
            job_id, fn, args = await q.get()
            try:
                if job_id is not None:
                    if job_id not in _pending:
                        continue  # cancelled while waiting
                    _pending.discard(job_id)
                asyncio.create_task(_run(job_id, fn, args))
            finally:
                q.task_done()

    asyncio.create_task(_dispatcher())
