"""Subf2m subtitle scraper — standalone, no subliminal_patch dependency."""

from __future__ import annotations

import functools
import io
import logging
import re
import time
import urllib.parse
import zipfile
from difflib import SequenceMatcher
from typing import Optional

import rarfile
import requests
from bs4 import BeautifulSoup
from guessit import guessit

logger = logging.getLogger(__name__)

_BASE_URL = "https://subf2m.co"

_SEASONS = (
    "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh",
    "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth", "Thirdteenth",
    "Fourthteenth", "Fifteenth", "Sixteenth", "Seventeenth", "Eightheenth",
    "Nineteenth", "Tweentieth",
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
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
_TV_SHOW_TITLE_RE = re.compile(
    r"^(.+?)\s+[-\(]\s?(.*?)\s+(season|series)\)?(\s+\((\d{4})\))?$"
)
_TV_SHOW_TITLE_ALT_RE = re.compile(r"(.+)\s(\d{1,2})(?:\s|$)")
_EPISODE_SPECIAL_RE = re.compile(
    r"(season|s)\s*?(?P<x>\d{,2})\s?[-−]\s?(?P<y>\d{,2})",
    flags=re.IGNORECASE,
)


class Subf2mProvider:
    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(_DEFAULT_HEADERS)

    def close(self) -> None:
        self._session.close()

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _get_text(self, url: str, retry: int = 3) -> str:
        for attempt in range(retry):
            resp = self._session.get(url, stream=True, timeout=20)
            if resp.status_code == 403:
                logger.debug("subf2m 403: %s", url)
                return ""
            if resp.status_code in (404, 503):
                logger.debug("subf2m %d attempt %d: %s", resp.status_code, attempt + 1, url)
                time.sleep(3)
                continue
            resp.raise_for_status()
            return "\n".join(line for line in resp.iter_lines(decode_unicode=True) if line)
        return ""

    # ------------------------------------------------------------------
    # Search helpers
    # ------------------------------------------------------------------

    def _gen_results(self, query: str):
        encoded = urllib.parse.quote(query)
        url = f"{_BASE_URL}/subtitles/searchbytitle?query={encoded}&l="
        text = self._get_text(url)
        soup = BeautifulSoup(text, "html.parser")
        for title in soup.select("li div[class='title'] a"):
            yield title

    def _search_movie(self, title: str, year: Optional[int], return_len: int = 3) -> list[str]:
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
            if year_s and match_year and year_s != match_year:
                continue
            results.append({
                "href": result.get("href"),
                "similarity": SequenceMatcher(None, title_lc, match_title).ratio(),
            })
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return list({r["href"] for r in results[:return_len]})

    def _search_tv_show_season(self, title: str, season: int, year: Optional[int] = None, return_len: int = 3) -> list[str]:
        try:
            season_strs = (_SEASONS[season - 1].lower(), str(season))
        except IndexError:
            logger.debug("subf2m: season %d not in lookup table", season)
            return []
        results = []
        for result in self._gen_results(title):
            text = result.text.strip().lower()
            m = _TV_SHOW_TITLE_RE.match(text) or _TV_SHOW_TITLE_ALT_RE.match(text)
            if not m:
                continue
            match_title = m.group(1).strip()
            match_season = m.group(2).strip().lower()
            if match_season in season_strs or "complete" in match_season:
                plus = 0.1 if year and str(year) in text else 0
                results.append({
                    "href": result.get("href"),
                    "similarity": SequenceMatcher(None, title.lower(), match_title).ratio() + plus,
                })
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return list({r["href"] for r in results[:return_len]})

    # ------------------------------------------------------------------
    # Subtitle listing helpers
    # ------------------------------------------------------------------

    def _get_subtitle_page_soup(self, path: str, lang_alpha2: str) -> BeautifulSoup:
        lang_path = _LANG_TO_PATH.get(lang_alpha2, "english")
        text = self._get_text(f"{_BASE_URL}{path}/{lang_path}")
        return BeautifulSoup(text, "html.parser")

    def _find_movie_subtitles(self, path: str, lang_alpha2: str) -> list[dict]:
        soup = self._get_subtitle_page_soup(path, lang_alpha2)
        subs = []
        for item in soup.select("li.item"):
            sub = _subtitle_from_item(item, lang_alpha2)
            if sub:
                subs.append(sub)
        return subs

    def _find_episode_subtitles(self, path: str, season: int, episode: int, lang_alpha2: str) -> list[dict]:
        soup = self._get_subtitle_page_soup(path, lang_alpha2)
        subs = []
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

    def search(self, video_path: str, lang_codes: list[str], is_episode: bool,
               title: str, year: Optional[int], season: int = 0, episode: int = 0) -> list[dict]:
        """Return list of subtitle candidate dicts for subtitle_service."""
        if is_episode:
            paths = self._search_tv_show_season(title, season, year)
        else:
            paths = self._search_movie(title, year)

        if not paths:
            logger.debug("subf2m: no title matches for %r", title)
            return []

        results: list[dict] = []
        for path in paths:
            for lang in lang_codes:
                if lang not in _LANG_TO_PATH:
                    continue
                if is_episode:
                    subs = self._find_episode_subtitles(path, season, episode, lang)
                else:
                    subs = self._find_movie_subtitles(path, lang)

                for sub in subs:
                    results.append({
                        "subtitle_id": sub["page_link"],
                        "provider": "subf2m",
                        "language": lang,
                        "release": sub["release_info"],
                        "score": 70,  # rough fixed score; no compute_score available
                        "hearing_impaired": False,
                    })

            if results:
                break  # stop at first path that yields results

        return results

    def download(self, page_link: str) -> Optional[bytes]:
        """Fetch subtitle page, find download link, return SRT/ASS bytes or None."""
        text = self._get_text(page_link)
        soup = BeautifulSoup(text, "html.parser")
        btn = soup.select_one("a[id='downloadButton']")
        if not btn or not btn.get("href"):
            logger.warning("subf2m: no downloadButton on %s", page_link)
            return None

        download_url = _BASE_URL + btn["href"]
        resp = self._session.get(download_url, allow_redirects=True, timeout=30)
        resp.raise_for_status()
        return _extract_from_archive(resp.content)


# ------------------------------------------------------------------
# Archive extraction
# ------------------------------------------------------------------

_SUBTITLE_EXTS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}


def _extract_from_archive(data: bytes) -> Optional[bytes]:
    # Try zip first
    if data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                candidates = [n for n in zf.namelist()
                              if any(n.lower().endswith(e) for e in _SUBTITLE_EXTS)]
                if candidates:
                    # prefer .srt; else first match
                    best = next((c for c in candidates if c.lower().endswith(".srt")), candidates[0])
                    return zf.read(best)
        except zipfile.BadZipFile:
            pass

    # Try rar
    if data[:4] in (b"Rar!", b"\x52\x61\x72\x21"):
        try:
            with rarfile.RarFile(io.BytesIO(data)) as rf:
                candidates = [n for n in rf.namelist()
                              if any(n.lower().endswith(e) for e in _SUBTITLE_EXTS)]
                if candidates:
                    best = next((c for c in candidates if c.lower().endswith(".srt")), candidates[0])
                    return rf.read(best)
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
    return guessit(content, {
        "type": "episode",
        "includes": ["season", "episode", "video_codec", "audio_codec"],
        "enforce_list": True,
    })


def _episode_from_release(release: str) -> Optional[dict]:
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

def _subtitle_from_item(item, lang_alpha2: str, episode_number: Optional[int] = None) -> Optional[dict]:
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

    return {
        "page_link": _BASE_URL + path,
        "language": lang_alpha2,
        "release_info": release_info,
        "episode_number": episode_number,
    }
