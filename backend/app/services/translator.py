"""Main-process proxy for offline translation (OPUS-MT on CTranslate2).

The model runs in a spawned worker (`worker_common.WorkerPool`), freed after two idle minutes
or when a job ends. Work goes in batches of `BATCH` lines; the cancel flag is checked between
batches, and a worker that has not finished within a few seconds of a cancel is terminated.
"""

import threading
from collections.abc import Callable

from app.services import _translate_impl
from app.services import translate_packs as packs
from app.services.worker_common import WorkerCancelled, WorkerPool

BATCH = 32
_pools: dict[tuple[str, int], WorkerPool] = {}
_pools_lock = threading.Lock()


def _pool_for(device: str, device_index: int) -> WorkerPool:
    """One worker per (device, card): a file runs on one card and cards never share a worker."""
    with _pools_lock:
        return _pools.setdefault((device, device_index), WorkerPool(idle_timeout=120.0))


class TranslationCancelled(Exception):
    pass


def release_sessions() -> None:
    with _pools_lock:
        pools = list(_pools.values())
    for p in pools:
        p.release()


def translate_texts(
    pack: dict,
    texts: list[str],
    is_cancelled: Callable[[], bool],
    on_progress: Callable[[int, int], None] | None = None,
    device: str = "cpu",
    device_index: int = 0,
) -> list[str]:
    """Translate English `texts` into the pack's language, same order, blank stays blank.
    Raises `TranslationCancelled` between batches (or when the worker had to be terminated)."""
    out = [""] * len(texts)
    todo = [i for i, t in enumerate(texts) if t.strip()]
    todo.sort(key=lambda i: len(texts[i]))  # similar lengths batch better
    done = 0
    for k in range(0, len(todo), BATCH):
        if is_cancelled():
            raise TranslationCancelled()
        ids = todo[k : k + BATCH]
        try:
            result = _pool_for(device, device_index).submit_cancellable(
                _translate_impl.translate_batch,
                packs.pack_dir(pack),
                pack["target_token"],
                [texts[i] for i in ids],
                4,
                device,
                device_index,
                is_cancelled=is_cancelled,
            )
        except WorkerCancelled:
            raise TranslationCancelled() from None
        for i, t in zip(ids, result, strict=True):
            out[i] = t
        done += len(ids)
        if on_progress:
            on_progress(done, len(todo))
    return out
