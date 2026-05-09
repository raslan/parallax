"""
Asyncio job queue with configurable concurrency.

Jobs are tracked by job_id so pending ones can be cancelled before they start.
A semaphore gates how many run concurrently; a single dispatcher pulls from the
queue and spawns tasks, each of which acquires the semaphore before running.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Any

_queue: asyncio.Queue | None = None
_pending: set[int] = set()
_semaphore: asyncio.Semaphore | None = None
_executor: ThreadPoolExecutor | None = None
_max_concurrent: int = 1


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
    global _max_concurrent, _semaphore, _executor
    _max_concurrent = n
    _semaphore = asyncio.Semaphore(n)
    _executor = ThreadPoolExecutor(max_workers=n, thread_name_prefix="job-worker")


async def enqueue(job_id: int | None, fn: Callable, *args: Any) -> None:
    """Enqueue a job. Pass job_id for cancellable jobs, None for fire-and-forget."""
    if job_id is not None:
        _pending.add(job_id)
    await _get_queue().put((job_id, fn, args))


def cancel_pending(job_id: int) -> bool:
    """Remove a queued-but-not-started job. Returns True if it was pending."""
    if job_id in _pending:
        _pending.discard(job_id)
        return True
    return False


async def start_worker() -> None:
    if _semaphore is None:
        init_queue(_max_concurrent)

    loop = asyncio.get_event_loop()
    q = _get_queue()

    async def _run(fn: Callable, args: tuple) -> None:
        async with _semaphore:
            try:
                await loop.run_in_executor(_executor, fn, *args)
            except Exception:
                pass

    async def _dispatcher() -> None:
        while True:
            job_id, fn, args = await q.get()
            try:
                if job_id is not None:
                    if job_id not in _pending:
                        continue  # cancelled while waiting
                    _pending.discard(job_id)
                asyncio.create_task(_run(fn, args))
            finally:
                q.task_done()

    asyncio.create_task(_dispatcher())
