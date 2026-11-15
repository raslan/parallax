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
from urllib.parse import urlparse


class ProviderError(Exception):
    """A source failed in a way worth telling the user (message is user-facing)."""


# The most a downloaded subtitle may be, in bytes. One constant for the archive reader and the
# preview, so a zip bomb is stopped before it is held in memory.
MAX_SUBTITLE_BYTES = 5 * 1024 * 1024


def own_url(subtitle_id: str, base: str) -> str:
    """A client-supplied id as a full URL on `base`'s own site, else ProviderError.

    Accepts a site-relative path (`/subtitles/x`) or a full URL whose scheme and host are
    exactly the base's (compared after parsing, so `base.evil.com` and `base@evil.com` fail).
    """
    refusal = ProviderError("Not a subtitle from this source")
    if not isinstance(subtitle_id, str) or any(c in subtitle_id for c in "\\\0\r\n\t "):
        raise refusal
    if subtitle_id.startswith("/") and not subtitle_id.startswith("//"):
        return base + subtitle_id
    parsed, own = urlparse(subtitle_id), urlparse(base)
    if parsed.scheme == own.scheme and parsed.netloc == own.netloc and parsed.path.startswith("/"):
        return subtitle_id
    raise refusal


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


def known_providers() -> frozenset[str]:
    _load()
    return frozenset(PROVIDERS)


def available_for(media_type: str) -> list[str]:
    _load()
    return sorted(n for n, cls in PROVIDERS.items() if media_type in cls.media_types)
