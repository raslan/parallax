# Portions of this file are derived from Bazarr
# (https://github.com/morpheus65535/bazarr), copyright morpheus65535 and
# contributors, licensed under the GNU General Public License v3.0.
# This file is distributed under the same GPL-3.0 license.
"""Subf2m subtitle scraper — standalone, no subliminal_patch dependency."""

from __future__ import annotations

import functools
import html
import io
import logging
import re
import time
import urllib.parse
import zipfile
from difflib import SequenceMatcher

import rarfile
import requests
from bs4 import BeautifulSoup
from guessit import guessit

from app.services.subtitle_providers import (
    MAX_SUBTITLE_BYTES,
    PROVIDERS,
    Politeness,
    ProviderError,
    SearchQuery,
    own_url,
)

logger = logging.getLogger(__name__)

_BASE_URL = "https://subf2m.co"
_PAGE_PATH_RE = re.compile(r"^/subtitles/[\w.-]+$")


def _pasted_page(path: str) -> str:
    """A user-pasted page as a `/subtitles/<slug>` path on this site, else ProviderError."""
    refusal = ProviderError("Not a Subf2m page")
    try:
        url = own_url(path, _BASE_URL)
    except ProviderError:
        raise refusal from None
    page = url.removeprefix(_BASE_URL)
    if not _PAGE_PATH_RE.match(page) or not page.removeprefix("/subtitles/").strip("."):
        raise refusal
    return page


_SEASONS = (
    "First",
    "Second",
    "Third",
    "Fourth",
    "Fifth",
    "Sixth",
    "Seventh",
    "Eighth",
    "Ninth",
    "Tenth",
    "Eleventh",
    "Twelfth",
    "Thirdteenth",
    "Fourthteenth",
    "Fifteenth",
    "Sixteenth",
    "Seventeenth",
    "Eightheenth",
    "Nineteenth",
    "Tweentieth",
)

_LANGUAGE_MAP = {
    "english": "en",
    "arabic": "ar",
    "farsi_persian": "fa",
    "spanish": "es",
    "portuguese": "pt",
    "brazillian-portuguese": "pt",
    "italian": "it",
    "dutch": "nl",
    "hebrew": "he",
    "indonesian": "id",
    "danish": "da",
    "norwegian": "no",
    "bengali": "bn",
    "bulgarian": "bg",
    "croatian": "hr",
    "swedish": "sv",
    "vietnamese": "vi",
    "czech": "cs",
    "finnish": "fi",
    "french": "fr",
    "german": "de",
    "greek": "el",
    "hungarian": "hu",
    "icelandic": "is",
    "japanese": "ja",
    "macedonian": "mk",
    "malay": "ms",
    "polish": "pl",
    "romanian": "ro",
    "russian": "ru",
    "serbian": "sr",
    "thai": "th",
    "turkish": "tr",
}

# lang alpha2 → subf2m path segment
_LANG_TO_PATH: dict[str, str] = {}
for _path, _alpha2 in _LANGUAGE_MAP.items():
    _LANG_TO_PATH.setdefault(_alpha2, _path)

_DEFAULT_HEADERS = {
    "accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9," "image/avif,image/webp,*/*;q=0.8"
    ),
    "accept-language": "en-US,en;q=0.9",
    "referer": "https://subf2m.co",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "upgrade-insecure-requests": "1",
    "user-agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

_MOVIE_TITLE_RE = re.compile(r"^(.+?)(\s+\((\d{4})\))?$")
_TV_SHOW_TITLE_RE = re.compile(r"^(.+?)\s+[-\(]\s?(.*?)\s+(season|series)\)?(\s+\((\d{4})\))?$")
_TV_SHOW_TITLE_ALT_RE = re.compile(r"(.+)\s(\d{1,2})(?:\s|$)")
_EPISODE_SPECIAL_RE = re.compile(
    r"(season|s)\s*?(?P<x>\d{,2})\s?[-−]\s?(?P<y>\d{,2})",
    flags=re.IGNORECASE,
)


def _season_slug_path(title: str, season: int) -> str | None:
    """Guess subf2m's season page path, e.g. ``/subtitles/stranger-things-first-season``.

    Used when the title search is down or finds nothing. A wrong guess just yields
    an empty (404) page, which the episode lookup treats as "no subtitles".
    """
    if not 1 <= season <= len(_SEASONS):
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower().replace("'", "")).strip("-")
    if not slug:
        return None
    return f"/subtitles/{slug}-{_SEASONS[season - 1].lower()}-season"


class Subf2mProvider:
    name = "subf2m"
    media_types = frozenset({"movie", "tv"})

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(_DEFAULT_HEADERS)
        self._politeness = Politeness.for_provider(self.name)

    def close(self) -> None:
        self._session.close()

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _get_text(self, url: str, retry: int = 3) -> str:
        """The page text; "" when the page does not exist (404 after retries).

        A refusal (403), an overloaded site (503 after retries), a timeout or any
        other HTTP failure raises ProviderError with a user-facing message.
        """
        status = 0
        for attempt in range(retry):
            try:
                with self._politeness.acquire():
                    resp = self._session.get(url, stream=True, timeout=20)
                    status = resp.status_code
                    if status == 403:
                        raise ProviderError("Subf2m refused the request (403)")
                    if status in (404, 503):
                        logger.debug("subf2m %d attempt %d: %s", status, attempt + 1, url)
                    else:
                        resp.raise_for_status()
                        return "\n".join(
                            line for line in resp.iter_lines(decode_unicode=True) if line
                        )
            except requests.Timeout as exc:
                raise ProviderError("Subf2m did not answer in time") from exc
            except requests.RequestException as exc:
                raise ProviderError(f"Subf2m request failed: {exc}") from exc
            time.sleep(3)
        if status == 503:
            raise ProviderError("Subf2m is overloaded (503), try again later")
        return ""

    # ------------------------------------------------------------------
    # Search helpers
    # ------------------------------------------------------------------

    def _gen_results(self, query: str):
        encoded = urllib.parse.quote(query)
        url = f"{_BASE_URL}/subtitles/searchbytitle?query={encoded}&l="
        text = self._get_text(url)
        soup = BeautifulSoup(text, "html.parser")
        yield from soup.select("li div[class='title'] a")

    def _search_movie(self, title: str, year: int | None, return_len: int = 3) -> list[str]:
        title_lc = title.lower()
        year_s = str(year) if year else ""
        results = []
        for result in self._gen_results(title_lc):
            text = result.text.strip().lower()
            m = _MOVIE_TITLE_RE.match(text)
            if not m:
                continue
            match_title = m.group(1)
            match_year = m.group(3) or ""
            results.append(
                {
                    "href": result.get("href"),
                    "similarity": SequenceMatcher(None, title_lc, match_title).ratio(),
                    "year_match": bool(year_s and match_year and year_s == match_year),
                }
            )
        if year_s:
            # An explicit year (TMDB pick or "(YYYY)") is authoritative — if any
            # candidate actually carries that year, only consider those, rather
            # than letting a same-titled different-year film outrank it on pure
            # string similarity (e.g. a 1998 movie sharing a 2012 remake's title).
            exact = [r for r in results if r["year_match"]]
            if exact:
                results = exact
        results.sort(key=lambda x: x["similarity"], reverse=True)
        # dict.fromkeys, not set() — a set does not preserve the similarity-sorted
        # order, so the ranking above would otherwise be silently discarded before
        # search() picks the first path with results.
        return list(dict.fromkeys(r["href"] for r in results[:return_len]))

    def _search_tv_show_season(
        self, title: str, season: int, year: int | None = None, return_len: int = 3
    ) -> list[str]:
        try:
            season_strs = (_SEASONS[season - 1].lower(), str(season))
        except IndexError:
            logger.debug("subf2m: season %d not in lookup table", season)
            return []
        results = []
        try:
            candidates = list(self._gen_results(title))
        except (requests.RequestException, ProviderError) as exc:
            # subf2m's search endpoint has been seen returning 500 for every query
            # while the show pages themselves still load fine.
            logger.warning("subf2m: title search failed (%s) — trying direct season URL", exc)
            candidates = []
        for result in candidates:
            text = result.text.strip().lower()
            m = _TV_SHOW_TITLE_RE.match(text) or _TV_SHOW_TITLE_ALT_RE.match(text)
            if m:
                match_title = m.group(1).strip()
                match_season = m.group(2).strip().lower()
            elif season == 1:
                # subf2m lists single-season/mini-series without a season suffix at all
                title_m = _MOVIE_TITLE_RE.match(text)
                match_title = title_m.group(1) if title_m else text
                match_season = "1"
            else:
                continue
            if match_season in season_strs or "complete" in match_season:
                plus = 0.1 if year and str(year) in text else 0
                results.append(
                    {
                        "href": result.get("href"),
                        "similarity": SequenceMatcher(None, title.lower(), match_title).ratio()
                        + plus,
                    }
                )
        results.sort(key=lambda x: x["similarity"], reverse=True)
        hrefs = list(dict.fromkeys(r["href"] for r in results[:return_len]))
        if not hrefs:
            slug_path = _season_slug_path(title, season)
            if slug_path:
                hrefs = [slug_path]
        return hrefs

    # ------------------------------------------------------------------
    # Subtitle listing helpers
    # ------------------------------------------------------------------

    def _get_subtitle_page_soup(self, path: str, lang_alpha2: str) -> BeautifulSoup:
        lang_path = _LANG_TO_PATH.get(lang_alpha2, "english")
        text = self._get_text(f"{_BASE_URL}{path}/{lang_path}")
        return BeautifulSoup(text, "html.parser")

    @staticmethod
    def _require_sublist(soup: BeautifulSoup) -> None:
        """A fetched page ("" means no such page) must have the subtitle list."""
        if soup.find() is not None and soup.select_one("ul.sublist") is None:
            raise ProviderError("Subf2m page changed: nothing matched ul.sublist")

    def _find_movie_subtitles(self, path: str, lang_alpha2: str) -> list[dict]:
        soup = self._get_subtitle_page_soup(path, lang_alpha2)
        subs = []
        self._require_sublist(soup)
        for item in soup.select("li.item"):
            sub = _subtitle_from_item(item, lang_alpha2)
            if sub:
                subs.append(sub)
        return subs

    def _find_episode_subtitles(
        self, path: str, season: int, episode: int, lang_alpha2: str
    ) -> list[dict]:
        soup = self._get_subtitle_page_soup(path, lang_alpha2)
        subs = []
        self._require_sublist(soup)
        for item in soup.select("li.item"):
            clean_text = " ".join(item.text.split())
            if not clean_text:
                continue
            guess = _episode_from_release(clean_text) or _memoized_episode_guess(clean_text)
            if "season" not in guess:
                if "complete series" in clean_text.lower():
                    guess["season"] = [season]
                else:
                    continue
            if season not in guess["season"]:
                continue
            if "episode" in guess and episode not in guess["episode"]:
                continue
            sub = _subtitle_from_item(item, lang_alpha2, episode)
            if sub:
                subs.append(sub)
        return subs

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def search(self, q: SearchQuery) -> list[dict]:
        """Return list of subtitle candidate dicts."""
        is_episode = q.identity.type == "tv"
        title, year = q.identity.title, q.identity.year
        season, episode = q.season or 1, q.episode or 1
        if q.identity.subf2m_path:
            paths = [_pasted_page(q.identity.subf2m_path)]
        elif is_episode:
            paths = self._search_tv_show_season(title, season, year)
        else:
            paths = self._search_movie(title, year)

        if not paths:
            logger.debug("subf2m: no title matches for %r", title)
            return []

        results: list[dict] = []
        errors: list[ProviderError] = []
        tried = 0
        for path in paths:
            for lang in q.languages:
                if lang not in _LANG_TO_PATH:
                    continue
                tried += 1
                try:
                    if is_episode:
                        subs = self._find_episode_subtitles(path, season, episode, lang)
                    else:
                        subs = self._find_movie_subtitles(path, lang)
                except ProviderError as exc:
                    errors.append(exc)
                    continue

                for sub in subs:
                    results.append(
                        {
                            "subtitle_id": sub["page_link"],
                            "provider": self.name,
                            "language": lang,
                            # One row can list many release names (plus the uploader's comment):
                            # the first is the name; the rest would read as one run-on blob.
                            # The page double-escapes some names ("&amp;amp;"): unescape once more.
                            "release": html.unescape(sub["release_info"].split("\n", 1)[0]),
                            "score": sub["score"],
                            "hearing_impaired": False,
                        }
                    )

            if results:
                break  # stop at first path that yields results

        if errors and len(errors) == tried:
            raise errors[0]  # every page failed: say why instead of "no results"
        return results

    def download(self, subtitle_id: str) -> bytes | None:
        """Fetch subtitle page, find download link, return SRT/ASS bytes or None."""
        page_link = own_url(subtitle_id, _BASE_URL)
        text = self._get_text(page_link)
        soup = BeautifulSoup(text, "html.parser")
        btn = soup.select_one("a[id='downloadButton']")
        if not btn or not btn.get("href"):
            logger.warning("subf2m: no downloadButton on %s", page_link)
            return None

        download_url = _BASE_URL + btn["href"]
        try:
            with self._politeness.acquire():
                resp = self._session.get(download_url, allow_redirects=True, timeout=30)
            resp.raise_for_status()
        except requests.Timeout as exc:
            raise ProviderError("Subf2m did not answer in time") from exc
        except requests.RequestException as exc:
            raise ProviderError(f"Subf2m download failed: {exc}") from exc
        return _extract_from_archive(resp.content)


PROVIDERS["subf2m"] = Subf2mProvider

# ------------------------------------------------------------------
# Archive extraction
# ------------------------------------------------------------------

_SUBTITLE_EXTS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}


def _too_large() -> ProviderError:
    return ProviderError("The subtitle in the download is too large to be a subtitle file.")


def _extract_from_archive(data: bytes) -> bytes | None:
    # Try zip first
    if data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                candidates = [
                    n for n in zf.namelist() if any(n.lower().endswith(e) for e in _SUBTITLE_EXTS)
                ]
                if candidates:
                    # prefer .srt; else first match
                    best = next(
                        (c for c in candidates if c.lower().endswith(".srt")), candidates[0]
                    )
                    if zf.getinfo(best).file_size > MAX_SUBTITLE_BYTES:
                        raise _too_large()
                    # declared sizes can lie: never read more than the cap + 1
                    with zf.open(best) as member:
                        body = member.read(MAX_SUBTITLE_BYTES + 1)
                    if len(body) > MAX_SUBTITLE_BYTES:
                        raise _too_large()
                    return body
        except zipfile.BadZipFile:
            pass

    # Try rar
    if data[:4] in (b"Rar!", b"\x52\x61\x72\x21"):
        try:
            with rarfile.RarFile(io.BytesIO(data)) as rf:
                candidates = [
                    n for n in rf.namelist() if any(n.lower().endswith(e) for e in _SUBTITLE_EXTS)
                ]
                if candidates:
                    best = next(
                        (c for c in candidates if c.lower().endswith(".srt")), candidates[0]
                    )
                    if rf.getinfo(best).file_size > MAX_SUBTITLE_BYTES:
                        raise _too_large()
                    with rf.open(best) as member:
                        body = member.read(MAX_SUBTITLE_BYTES + 1)
                    if len(body) > MAX_SUBTITLE_BYTES:
                        raise _too_large()
                    return body
        except ProviderError:
            raise
        except Exception:
            pass

    # Maybe raw subtitle
    if data[:6] in (b"WEBVTT", b"1\r\n", b"1\n") or b"-->" in data[:1024]:
        return data

    logger.warning("subf2m: unrecognised archive format (first bytes: %s)", data[:4])
    return None


# ------------------------------------------------------------------
# Guessit helpers
# ------------------------------------------------------------------


@functools.lru_cache(maxsize=2048)
def _memoized_episode_guess(content: str) -> dict:
    return guessit(
        content,
        {
            "type": "episode",
            "includes": ["season", "episode", "video_codec", "audio_codec"],
            "enforce_list": True,
        },
    )


def _episode_from_release(release: str) -> dict | None:
    m = _EPISODE_SPECIAL_RE.search(release)
    if not m:
        return None
    try:
        season, episode = int(m.group("x")), int(m.group("y"))
        return {"season": [season], "episode": [episode]}
    except (IndexError, ValueError):
        return None


# ------------------------------------------------------------------
# Item parsing
# ------------------------------------------------------------------


def _subtitle_from_item(item, lang_alpha2: str, episode_number: int | None = None) -> dict | None:
    release_parts = [rel.text.strip() for rel in item.find("ul", {"class": "scrolllist"}) or []]
    try:
        comment = item.find("div", {"class": "comment-col"}).find("p").text
        release_parts.append(comment.replace("\n", " ").strip())
    except AttributeError:
        pass
    release_info = "\n".join(p for p in release_parts if p)

    try:
        path = item.find("a", {"class": "download icon-download"})["href"]
    except (AttributeError, KeyError, TypeError):
        return None

    # subf2m has no numeric rating or download count — each item is tagged
    # with a coarse "rate" widget instead (class is "rate good"/"rate bad"/
    # "rate not rated", tokenized by BeautifulSoup into separate class names,
    # not one combined string). Map that to a score comparable to yts-subs'
    # rating-derived 0-100 scale, rather than the flat constant this used to
    # return for every result regardless of quality.
    rate_el = item.find("span", class_="rate")
    rate_classes = set(rate_el.get("class", [])) if rate_el else set()
    if "good" in rate_classes:
        score = 80
    elif "bad" in rate_classes:
        score = 20
    else:
        score = 50  # not rated, or rate widget absent

    return {
        "page_link": _BASE_URL + path,
        "language": lang_alpha2,
        "release_info": release_info,
        "episode_number": episode_number,
        "score": score,
    }
