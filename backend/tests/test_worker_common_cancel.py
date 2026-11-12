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
