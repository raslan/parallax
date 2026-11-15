"""One interface for the subtitle sources, plus the politeness every request obeys.

Providers register themselves in ``PROVIDERS`` when their module is imported;
``get_provider`` / ``available_for`` make sure both modules are loaded first.
"""

from __future__ import annotations

import importlib
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal, Protocol


class ProviderError(Exception):
    """A source failed in a way worth telling the user (message is user-facing)."""


@dataclass(frozen=True)
class Identity:
    title: str
    year: int | None
    type: Literal["movie", "tv"]
    imdb_id: str | None = None
    tmdb_id: int | None = None


@dataclass(frozen=True)
class SearchQuery:
    identity: Identity
    languages: tuple[str, ...]
    season: int | None
    episode: int | None
    video_path: str | None


class Provider(Protocol):
    name: str
    media_types: frozenset[str]

    def search(self, q: SearchQuery) -> list[dict]: ...

    def download(self, subtitle_id: str) -> bytes | None: ...

    def close(self) -> None: ...


class Politeness:
    """At most ``max_concurrent`` requests in flight and ``min_gap`` seconds between starts."""

    _instances: dict[str, Politeness] = {}
    _instances_lock = threading.Lock()

    def __init__(
        self,
        max_concurrent: int = 2,
        min_gap: float = 0.25,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._slots = threading.Semaphore(max_concurrent)
        self._min_gap = min_gap
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._next_start = 0.0

    @classmethod
    def for_provider(cls, name: str) -> Politeness:
        with cls._instances_lock:
            return cls._instances.setdefault(name, cls())

    @contextmanager
    def acquire(self):
        self._slots.acquire()
        try:
            with self._lock:
                start = max(self._clock(), self._next_start)
                self._next_start = start + self._min_gap
                wait = start - self._clock()
            if wait > 0:
                self._sleep(wait)
            yield
        finally:
            self._slots.release()


PROVIDERS: dict[str, type] = {}


def _load() -> None:
    importlib.import_module("app.services.subf2m_provider")
    importlib.import_module("app.services.ytssubs_provider")


def get_provider(name: str) -> Provider:
    _load()
    cls = PROVIDERS.get(name)
    if cls is None:
        raise ValueError("Unknown source")
    return cls()


def available_for(media_type: str) -> list[str]:
    _load()
    return sorted(n for n, cls in PROVIDERS.items() if media_type in cls.media_types)
