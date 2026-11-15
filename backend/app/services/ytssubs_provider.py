"""yts-subs.com subtitle scraper (mirror of the dead yifysubtitles.com), films only.

Subtitles live under a film's IMDB id (`/movie-imdb/{imdb_id}`). The site also
has its own title search (`/search/<query>`, film cards with IMDB id and
poster), so a film can be identified here with no TMDB key. No auth, no
Cloudflare challenge observed.
"""

from __future__ import annotations

import base64
import html
import logging
import re
import urllib.parse

import requests
from bs4 import BeautifulSoup

from app.services.subf2m_provider import _extract_from_archive
from app.services.subtitle_providers import (
    PROVIDERS,
    Politeness,
    ProviderError,
    SearchQuery,
    own_url,
)

logger = logging.getLogger(__name__)

_BASE_URL = "https://yts-subs.com"

_DEFAULT_HEADERS = {
    "accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9," "image/avif,image/webp,*/*;q=0.8"
    ),
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

_COVER_YEAR_RE = re.compile(r"-(\d{4})-tt\d+")
_IMDB_HREF_RE = re.compile(r"^/movie-imdb/(tt\d+)")


def _lang_name_to_alpha2(name: str) -> str | None:
    try:
        from babelfish import Language

        return str(Language.fromname(name).alpha2)
    except Exception:
        return None


class YtsSubsProvider:
    name = "yts"
    media_types = frozenset({"movie"})

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(_DEFAULT_HEADERS)
        self._politeness = Politeness.for_provider(self.name)

    def close(self) -> None:
        self._session.close()

    def _get_text(self, url: str, timeout: int = 20) -> str:
        """The page text, "" for a 404; ProviderError for anything else that goes wrong."""
        try:
            with self._politeness.acquire():
                resp = self._session.get(url, timeout=timeout)
            if resp.status_code == 404:
                return ""
            resp.raise_for_status()
            return resp.text
        except requests.Timeout as exc:
            raise ProviderError("YTS Subs did not answer in time") from exc
        except requests.RequestException as exc:
            logger.debug("yts request failed for %s: %s", url, exc)
            raise ProviderError(f"YTS Subs request failed: {exc}") from exc

    def search_titles(self, query: str) -> list[dict]:
        """Film cards from the site's own title search."""
        text = self._get_text(f"{_BASE_URL}/search/{urllib.parse.quote(query)}")
        if not text:
            return []
        soup = BeautifulSoup(text, "html.parser")
        if soup.select_one("ul.media-list") is None:
            raise ProviderError("YTS Subs page changed: nothing matched ul.media-list")

        results: list[dict] = []
        for card in soup.select("ul.media-list li.media-movie-clickable"):
            link = card.select_one("a[href^='/movie-imdb/']")
            m = _IMDB_HREF_RE.match(link["href"]) if link else None
            if not m:
                continue
            img = card.select_one("img.media-object")
            poster = img.get("src") if img else None
            year_m = _COVER_YEAR_RE.search(poster or "")
            heading = card.select_one("h3.media-heading")
            results.append(
                {
                    "title": heading.get_text(strip=True) if heading else "",
                    "year": int(year_m.group(1)) if year_m else None,
                    "imdb_id": m.group(1),
                    "poster_url": poster or None,
                }
            )
        return results

    def search(self, q: SearchQuery) -> list[dict]:
        """Subtitle candidates for a film, by IMDB id (empty when the identity has none)."""
        imdb_id = q.identity.imdb_id
        if not imdb_id:
            return []
        text = self._get_text(f"{_BASE_URL}/movie-imdb/{imdb_id}")
        if not text:
            return []

        soup = BeautifulSoup(text, "html.parser")
        if soup.select_one("table.other-subs") is None:
            # A film page with no subtitles keeps its title block but has no table;
            # a page with neither is a layout we do not know.
            if soup.select_one("h2.movie-main-title") is not None:
                return []
            raise ProviderError("YTS Subs page changed: nothing matched table.other-subs")
        wanted = set(q.languages)
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
            release = html.unescape(release_el.text.strip()) if release_el else ""

            results.append(
                {
                    "subtitle_id": link_el["href"],
                    "provider": self.name,
                    "language": lang,
                    "release": release,
                    "score": max(0, rating) * 20,
                    "hearing_impaired": False,
                }
            )

        return results

    def download(self, subtitle_id: str) -> bytes | None:
        """Fetch the subtitle detail page, decode the base64 link, return SRT bytes or None."""
        text = self._get_text(own_url(subtitle_id, _BASE_URL))
        if not text:
            return None

        soup = BeautifulSoup(text, "html.parser")
        btn = soup.select_one("a#btn-download-subtitle")
        encoded = btn.get("data-link") if btn else None
        if not encoded:
            logger.warning("yts: no download link on %s", subtitle_id)
            return None

        try:
            download_url = base64.b64decode(encoded).decode()
        except Exception:
            logger.warning("yts: undecodable data-link on %s", subtitle_id)
            return None

        try:
            with self._politeness.acquire():
                resp = self._session.get(download_url, timeout=30)
            resp.raise_for_status()
        except requests.Timeout as exc:
            raise ProviderError("YTS Subs did not answer in time") from exc
        except requests.RequestException as exc:
            raise ProviderError(f"YTS Subs download failed: {exc}") from exc
        return _extract_from_archive(resp.content)


PROVIDERS["yts"] = YtsSubsProvider
