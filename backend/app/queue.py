"""
Asyncio job queue with a single background worker thread.
All scan/check/transcode jobs are enqueued here so they run one at a time
and don't overwhelm the system.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Any

_queue: asyncio.Queue | None = None
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="job-worker")


def _get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


async def enqueue(fn: Callable, *args: Any) -> None:
    await _get_queue().put((fn, args))


async def start_worker() -> None:
    loop = asyncio.get_event_loop()
    q = _get_queue()

    async def _worker():
        while True:
            fn, args = await q.get()
            try:
                await loop.run_in_executor(_executor, fn, *args)
            except Exception:
                pass
            finally:
                q.task_done()

    asyncio.create_task(_worker())
