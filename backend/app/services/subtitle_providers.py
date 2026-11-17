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

import requests


class ProviderError(Exception):
    """A source failed in a way worth telling the user (message is user-facing)."""


class ProviderNetworkError(ProviderError):
    """No route, DNS failure, connection reset or timeout. The only failure that is retried:
    a source that answered badly (403, no matches, a changed layout) will answer the same."""


def request_failure(exc: requests.RequestException, message: str) -> ProviderError:
    """`message` as a ProviderNetworkError for a connection-level failure, else a ProviderError."""
    connection_level = (
        requests.ConnectionError,
        requests.Timeout,
        requests.exceptions.ChunkedEncodingError,
    )
    if isinstance(exc, connection_level):
        return ProviderNetworkError(message)
    return ProviderError(message)


# The most a downloaded subtitle may be, in bytes. One constant for the archive reader and the
# preview, so a zip bomb is stopped before it is held in memory.
MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
# The most a downloaded archive may be, and how many files it may list (the season packs seen
# were 0.1 to 0.7 MB). Nothing is extracted to disk; one member is read, with the cap above.
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 2000


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
    # A pasted Subf2m page (`/subtitles/<slug>`): that exact page is searched, not a title.
    subf2m_path: str | None = None


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

    def fetch(self, subtitle_id: str) -> bytes:
        """The raw bytes as downloaded (an archive or a subtitle), capped. Raises ProviderError
        when there is no download or the body is empty or a web page."""
        ...

    def extract(
        self, raw: bytes, *, season: int | None = None, episode: int | None = None
    ) -> bytes | None:
        """The one subtitle inside `raw`; for a season pack, the file of that episode."""
        ...

    def download(
        self, subtitle_id: str, *, season: int | None = None, episode: int | None = None
    ) -> bytes | None:
        """`extract(fetch(subtitle_id))`."""
        ...

    def close(self) -> None: ...


def read_capped(resp, limit: int = MAX_ARCHIVE_BYTES) -> bytes:
    """The body of a streamed response, read in chunks and abandoned the moment it passes
    `limit`, so a hostile or broken download is never held in memory whole. Closes `resp`."""
    try:
        declared = resp.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise ProviderError("The download is too large to be a subtitle file.")
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > limit:
                raise ProviderError("The download is too large to be a subtitle file.")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        resp.close()


def require_subtitle_body(body: bytes) -> bytes:
    """An empty body, or a web page where a file was promised, is not a subtitle."""
    if not body.strip() or body.lstrip()[:1] == b"<":
        raise ProviderError("The source returned no subtitle for that choice.")
    return body


SUBF2M_GAP = 1.0
DEFAULT_GAP = 0.25


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
        """subf2m is asked politely: 1 s between request starts. Other sources 0.25 s."""
        with cls._instances_lock:
            gap = SUBF2M_GAP if name == "subf2m" else DEFAULT_GAP
            return cls._instances.setdefault(name, cls(min_gap=gap))

    @contextmanager
    def acquire(self, timeout: float | None = None):
        """Wait for a request slot (and the gap). With `timeout`, give up with a ProviderError
        instead of waiting forever; a slot that was not taken is never leaked."""
        if timeout is None:
            self._slots.acquire()
        elif not self._slots.acquire(timeout=timeout):
            raise ProviderError("The source is busy, try again")
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
