"""Which film or show a video is: pasted ids and links, and a guess per title group.

Identity is per run and nothing here is remembered.
"""

from __future__ import annotations

import logging
import os
import re
from urllib.parse import urlparse

from app.services import renamer, tmdb

logger = logging.getLogger(__name__)

_IMDB_ID_RE = re.compile(r"^tt\d{6,}$")
_IMDB_IN_PATH_RE = re.compile(r"/(?:title|movie-imdb)/(tt\d{6,})(?:/|$)")
_SEASON_DIR_RE = re.compile(r"^Season \d{2}$")
_SUBF2M_PATH_RE = re.compile(r"^(/subtitles/[\w.-]+)(?:/[\w-]+)?$")
_GARBAGE = "Not an IMDB id or a supported link"
# TMDB is asked at most this many times per request (each call can take up to 10 s).
MAX_TMDB_LOOKUPS = 25


def parse_pasted(text: str) -> dict:
    """An IMDB id, an IMDB / yts-subs link, or a subf2m page link."""
    s = (text or "").strip()
    if _IMDB_ID_RE.match(s):
        return {"imdb_id": s}
    if "://" not in s:
        raise ValueError(_GARBAGE)
    try:
        url = urlparse(s)
        host_name = url.hostname
    except ValueError:
        raise ValueError(_GARBAGE) from None
    host = (host_name or "").lower().removeprefix("www.")
    if host in ("imdb.com", "m.imdb.com", "yts-subs.com"):
        m = _IMDB_IN_PATH_RE.search(url.path)
        if m:
            return {"imdb_id": m.group(1)}
    elif host == "subf2m.co":
        path = url.path.rstrip("/")
        m = _SUBF2M_PATH_RE.match(path)
        if m and not m.group(1).removeprefix("/subtitles/").strip("."):
            pass  # a slug made only of dots is a path trick, not a page
        elif m:
            return {"subf2m_path": m.group(1)}
    raise ValueError(_GARBAGE)


def _tmdb_key() -> str:
    from app.database import SessionLocal
    from app.models.settings import get_setting

    db = SessionLocal()
    try:
        return get_setting(db, "tmdb_api_key", "").strip()
    finally:
        db.close()


def _guess(name: str) -> dict:
    from guessit import guessit

    info = guessit(name)
    return {
        "title": str(info.get("title", "")).strip(),
        "year": info.get("year"),
        "season": info.get("season") if isinstance(info.get("season"), int) else None,
        "type": "tv" if info.get("type") == "episode" else "movie",
    }


def _identify_file(root: str, path: str, folder_cache: dict[str, dict]) -> dict:
    """Title/year/type of one video: its own name, else the nearest folder that reads as a title."""
    info = _guess(os.path.basename(path))
    if not info["title"]:
        root_real = os.path.normpath(root)
        folder = os.path.dirname(os.path.normpath(path))
        while folder and folder != root_real and folder.startswith(root_real):
            guessed = folder_cache.get(folder) or folder_cache.setdefault(
                folder, _guess(os.path.basename(folder))
            )
            if guessed["title"] and not _SEASON_DIR_RE.match(os.path.basename(folder)):
                info = {**guessed, "type": info["type"]}
                break
            folder = os.path.dirname(folder)
    if info["year"] is None and info["title"]:
        # A show's year usually lives on its folder ("Show (2016)/Season 01/...").
        parent = os.path.dirname(os.path.normpath(path))
        for _ in range(2):
            g = folder_cache.get(parent) or folder_cache.setdefault(
                parent, _guess(os.path.basename(parent))
            )
            if g["year"] and g["title"].casefold() == info["title"].casefold():
                info = {**info, "year": g["year"]}
                break
            parent = os.path.dirname(parent)
    return info


def _layout_clean(kind: str, title: str, year: int | None, files: list[str]) -> bool:
    if kind == "movie":
        if year is None:
            return False
        want = renamer.movie_folder_name(title, year).casefold()
        return all(os.path.basename(os.path.dirname(f)).casefold() == want for f in files)
    plain = renamer.safe_name(title).casefold()
    with_year = renamer.movie_folder_name(title, year).casefold() if year else plain
    for f in files:
        season_dir = os.path.dirname(f)
        show_dir = os.path.basename(os.path.dirname(season_dir)).casefold()
        if not _SEASON_DIR_RE.match(os.path.basename(season_dir)):
            return False
        if show_dir not in (plain, with_year):
            return False
    return True


class _TmdbBudget:
    """At most MAX_TMDB_LOOKUPS calls per request, and none after the first failure."""

    def __init__(self, key: str) -> None:
        self.key = key
        self.left = MAX_TMDB_LOOKUPS if key else 0

    def needs_choice(self, title: str, kind: str) -> bool:
        if self.left <= 0:
            return False
        self.left -= 1
        try:
            results = tmdb.search(title, kind, self.key)
        except Exception as exc:  # TMDB down or key rejected: stop asking this request
            logger.debug("TMDB lookup for %r failed: %s", title, exc)
            self.left = 0
            return False
        return len({r.get("year") for r in results if r.get("year")}) >= 2


def suggest_groups(root: str, video_paths: list[str]) -> list[dict]:
    """Group videos by guessed title + year + type. No folder walks: the caller lists the videos."""
    folder_cache: dict[str, dict] = {}
    groups: dict[tuple, dict] = {}
    for path in video_paths:
        info = _identify_file(root, path, folder_cache)
        stem = os.path.splitext(os.path.basename(path))[0]
        # A file with no readable title stays alone instead of merging with strangers.
        title = info["title"] or stem
        k = (info["type"], title.casefold(), info["year"])
        g = groups.setdefault(
            k, {"title": title, "year": info["year"], "type": info["type"], "files": []}
        )
        g["files"].append(path)

    budget = _TmdbBudget(_tmdb_key())
    out = []
    for (kind, _t, year), g in groups.items():
        files = sorted(g["files"])
        out.append(
            {
                "key": f"{kind}:{g['title'].casefold()}:{year or ''}",
                "title": g["title"],
                "year": year,
                "type": kind,
                "files": files,
                "layout_clean": _layout_clean(kind, g["title"], year, files),
                "needs_choice": year is None and budget.needs_choice(g["title"], kind),
            }
        )
    out.sort(key=lambda g: g["title"].casefold())
    return out
