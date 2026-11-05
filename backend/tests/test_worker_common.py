import os

import pytest

from app.services.worker_common import WorkerPool


def _pid() -> int:
    return os.getpid()


def _crash_once(flag_path: str) -> int:
    """Kills the worker the first time it runs, succeeds afterwards."""
    if not os.path.exists(flag_path):
        open(flag_path, "w").close()
        os._exit(1)
    return os.getpid()


@pytest.fixture
def pool():
    p = WorkerPool(idle_timeout=60)
    yield p
    p.release()


def test_submit_runs_in_other_process(pool):
    assert pool.submit(_pid) != os.getpid()


def test_worker_is_reused_between_calls(pool):
    assert pool.submit(_pid) == pool.submit(_pid)


def test_release_then_submit_respawns(pool):
    first = pool.submit(_pid)
    pool.release()
    assert pool.submit(_pid) != first


def test_release_without_worker_is_noop():
    WorkerPool().release()


def test_broken_executor_retried_once(pool, tmp_path):
    pid = pool.submit(_crash_once, str(tmp_path / "flag"))
    assert pid != os.getpid()


def test_idle_timeout_releases_worker():
    import time

    p = WorkerPool(idle_timeout=0.2)
    first = p.submit(_pid)
    time.sleep(0.6)
    assert p._executor is None
    assert p.submit(_pid) != first
    p.release()
