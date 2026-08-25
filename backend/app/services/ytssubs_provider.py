"""yts-subs.com subtitle scraper (mirror of the dead yifysubtitles.com).

Unlike subf2m, this site has no title-search endpoint — subtitles are only
reachable via a movie's IMDB ID (`/movie-imdb/{imdb_id}`), so callers must
resolve that first (this repo does it via TMDB). No auth, no rate limiting,
no Cloudflare challenge observed.
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

import requests
from bs4 import BeautifulSoup

from app.services.subf2m_provider import _extract_from_archive

logger = logging.getLogger(__name__)

_BASE_URL = "https://yts-subs.com"

_DEFAULT_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


def _lang_name_to_alpha2(name: str) -> Optional[str]:
    try:
        from babelfish import Language
        return str(Language.fromname(name).alpha2)
    except Exception:
        return None


class YtsSubsProvider:
    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(_DEFAULT_HEADERS)

    def close(self) -> None:
        self._session.close()

    def _get_text(self, url: str, timeout: int = 20) -> str:
        try:
            resp = self._session.get(url, timeout=timeout)
            if resp.status_code == 404:
                return ""
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            logger.debug("ytssubs request failed for %s: %s", url, exc)
            return ""

    def search(self, imdb_id: str, lang_codes: list[str]) -> list[dict]:
        """Return list of subtitle candidate dicts for subtitle_service.

        Movie-only (yts-subs has no per-episode listing structure)."""
        if not imdb_id:
            return []
        text = self._get_text(f"{_BASE_URL}/movie-imdb/{imdb_id}")
        if not text:
            return []

        soup = BeautifulSoup(text, "html.parser")
        wanted = set(lang_codes)
        results: list[dict] = []

        for row in soup.select("table.other-subs tbody tr"):
            lang_el = row.select_one("td.flag-cell span.sub-lang")
            link_el = row.select_one("td.download-cell a.subtitle-download")
            if not lang_el or not link_el or not link_el.get("href"):
                continue

            lang = _lang_name_to_alpha2(lang_el.text.strip())
            if lang is None or lang not in wanted:
                continue

            rating_el = row.select_one("td.rating-cell span.label")
            try:
                rating = int(rating_el.text.strip()) if rating_el else 0
            except ValueError:
                rating = 0

            release_el = row.select_one("td:nth-of-type(3)")
            release = release_el.text.strip() if release_el else ""

            results.append({
                "subtitle_id": link_el["href"],
                "provider": "ytssubs",
                "language": lang,
                "release": release,
                "score": max(0, rating) * 20,
                "hearing_impaired": False,
            })

        return results

    def download(self, page_path: str) -> Optional[bytes]:
        """Fetch subtitle detail page, decode the base64 download link, return
        SRT bytes or None."""
        text = self._get_text(f"{_BASE_URL}{page_path}")
        if not text:
            return None

        soup = BeautifulSoup(text, "html.parser")
        btn = soup.select_one("a#btn-download-subtitle")
        encoded = btn.get("data-link") if btn else None
        if not encoded:
            logger.warning("ytssubs: no download link on %s", page_path)
            return None

        try:
            download_url = base64.b64decode(encoded).decode()
        except Exception:
            logger.warning("ytssubs: undecodable data-link on %s", page_path)
            return None

        resp = self._session.get(download_url, timeout=30)
        resp.raise_for_status()
        return _extract_from_archive(resp.content)
