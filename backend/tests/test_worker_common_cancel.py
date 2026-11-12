import os
import time

import pytest

from app.services.worker_common import WorkerCancelled, WorkerPool


def _pid() -> int:
    return os.getpid()


def _die() -> None:
    os._exit(1)


def _sleep(seconds: float) -> str:
    time.sleep(seconds)
    return "done"


def test_finishes_normally_when_never_cancelled():
    pool = WorkerPool(idle_timeout=60)
    try:
        assert pool.submit_cancellable(_sleep, 0.1, is_cancelled=lambda: False) == "done"
    finally:
        pool.release()


def test_cancel_terminates_a_busy_worker_after_the_grace_period():
    pool = WorkerPool(idle_timeout=60)
    try:
        first = pool.submit(_pid)
        started = time.monotonic()
        with pytest.raises(WorkerCancelled):
            pool.submit_cancellable(
                _sleep, 60, is_cancelled=lambda: time.monotonic() - started > 0.3, grace=0.5
            )
        assert time.monotonic() - started < 10  # did not wait for the 60 s sleep
        assert pool.submit(_pid) != first  # a fresh worker was spawned on next use
    finally:
        pool.release()


def _raise_timeout() -> None:
    raise TimeoutError("raised by the worker function itself")


def test_a_timeout_raised_by_the_worker_is_an_error_not_a_hang():
    pool = WorkerPool(idle_timeout=60)
    try:
        with pytest.raises(TimeoutError):
            pool.submit_cancellable(_raise_timeout, is_cancelled=lambda: False)
    finally:
        pool.release()


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def test_cancel_really_kills_the_old_worker_process():
    pool = WorkerPool(idle_timeout=60)
    try:
        pid = pool.submit(_pid)
        started = time.monotonic()
        with pytest.raises(WorkerCancelled):
            pool.submit_cancellable(
                _sleep, 60, is_cancelled=lambda: time.monotonic() - started > 0.3, grace=0.5
            )
        deadline = time.monotonic() + 5
        while _alive(pid) and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not _alive(pid)
    finally:
        pool.release()


def test_a_call_that_ends_inside_the_grace_period_returns_its_result():
    pool = WorkerPool(idle_timeout=60)
    try:
        assert pool.submit_cancellable(_sleep, 0.4, is_cancelled=lambda: True, grace=10) == "done"
    finally:
        pool.release()


def test_worker_death_is_retried_once_then_raised():
    pool = WorkerPool(idle_timeout=60)
    try:
        from concurrent.futures import BrokenExecutor

        with pytest.raises(BrokenExecutor):
            pool.submit_cancellable(_die, is_cancelled=lambda: False)
        # the pool recovers for the next call
        assert pool.submit_cancellable(_sleep, 0, is_cancelled=lambda: False) == "done"
    finally:
        pool.release()


def test_a_future_cancelled_by_another_threads_release_counts_as_a_cancel():
    from concurrent.futures import Future

    class Fake:
        def submit(self, fn, *a):
            f = Future()
            f.cancel()
            f.set_running_or_notify_cancel()  # what a real shutdown does for queued work
            return f

    pool = WorkerPool(idle_timeout=60)
    pool._get_executor = lambda: Fake()  # type: ignore[method-assign]
    with pytest.raises(WorkerCancelled):
        pool.submit_cancellable(_sleep, 0, is_cancelled=lambda: False)
