"""Provider interface, politeness, and parsers against saved site pages."""

import threading
import time
from pathlib import Path

import pytest

from app.services import subtitle_providers as sp
from app.services.subf2m_provider import Subf2mProvider
from app.services.ytssubs_provider import YtsSubsProvider

FIXTURES = Path(__file__).parent / "fixtures" / "subtitles"


def _page(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _query(**kw) -> sp.SearchQuery:
    ident = kw.pop("identity", sp.Identity("Obsession", 2025, "movie", imdb_id="tt37287335"))
    base = dict(identity=ident, languages=("en", "ar"), season=None, episode=None, video_path=None)
    base.update(kw)
    return sp.SearchQuery(**base)


def test_yts_search_titles_parses_saved_page(monkeypatch):
    p = YtsSubsProvider()
    seen = []
    monkeypatch.setattr(
        p, "_get_text", lambda url, **_k: seen.append(url) or _page("yts_search.html")
    )
    results = p.search_titles("obsession")
    assert seen == ["https://yts-subs.com/search/obsession"]
    first = results[0]
    assert first["imdb_id"] == "tt37287335"
    assert first["year"] == 2025
    assert first["title"] == "Obsession"
    assert first["poster_url"].startswith("https://")
    assert all(r["imdb_id"].startswith("tt") for r in results)


def test_yts_search_parses_saved_movie_page(monkeypatch):
    p = YtsSubsProvider()
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: _page("yts_movie.html"))
    results = p.search(_query(languages=("en", "ar", "fr")))
    assert results
    for r in results:
        assert r["provider"] == "yts"
        assert r["language"] in {"en", "ar", "fr"}
        assert r["subtitle_id"].startswith("/")
    assert {r["language"] for r in results} >= {"en"}


def test_yts_search_without_imdb_id_is_empty():
    q = _query(identity=sp.Identity("Obsession", 2025, "movie"))
    assert YtsSubsProvider().search(q) == []


def test_subf2m_search_parses_saved_page(monkeypatch):
    p = Subf2mProvider()
    pages = {"search": _page("subf2m_search.html"), "movie": _page("subf2m_movie.html")}
    monkeypatch.setattr(
        p, "_get_text", lambda url, **_k: pages["search" if "searchbytitle" in url else "movie"]
    )
    q = _query(identity=sp.Identity("Obsession", 2025, "movie"), languages=("en",))
    results = p.search(q)
    assert results
    assert all(r["provider"] == "subf2m" for r in results)
    assert all(r["language"] == "en" for r in results)
    assert results[0]["subtitle_id"].startswith("https://subf2m.co/subtitles/obsession-2025/")


def test_available_for_tv_excludes_yts():
    assert sp.available_for("tv") == ["subf2m"]
    assert sp.available_for("movie") == ["subf2m", "yts"]


def test_get_provider_unknown_raises():
    with pytest.raises(ValueError, match="Unknown source"):
        sp.get_provider("nope")
    assert set(sp.PROVIDERS) == {"subf2m", "yts"}
    p = sp.get_provider("yts")
    assert p.name == "yts"
    p.close()


class _Clock:
    def __init__(self):
        self.now = 100.0
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.now += s


def test_politeness_limits_concurrency_and_spacing():
    clock = _Clock()
    pol = sp.Politeness(clock=clock.time, sleep=clock.sleep)
    starts = []
    for _ in range(3):
        with pol.acquire():
            starts.append(clock.now)
    assert starts[1] - starts[0] >= 0.25
    assert starts[2] - starts[1] >= 0.25

    # Two requests in flight; a third must wait until one finishes.
    a, b = pol.acquire(), pol.acquire()
    a.__enter__()
    b.__enter__()
    entered = threading.Event()

    def third():
        with pol.acquire():
            entered.set()

    t = threading.Thread(target=third)
    t.start()
    time.sleep(0.2)
    assert not entered.is_set()
    a.__exit__(None, None, None)
    assert entered.wait(2)
    b.__exit__(None, None, None)
    t.join(2)


def test_selector_drift_names_the_selector(monkeypatch):
    yts = YtsSubsProvider()
    monkeypatch.setattr(yts, "_get_text", lambda url, **_k: "<html></html>")
    with pytest.raises(sp.ProviderError, match=r"table\.other-subs"):
        yts.search(_query())
    with pytest.raises(sp.ProviderError, match=r"ul\.media-list"):
        yts.search_titles("obsession")

    sub = Subf2mProvider()
    monkeypatch.setattr(sub, "_get_text", lambda url, **_k: "<html></html>")
    monkeypatch.setattr(sub, "_search_movie", lambda *_a, **_k: ["/subtitles/obsession-2025"])
    with pytest.raises(sp.ProviderError, match=r"ul\.sublist"):
        sub.search(_query(identity=sp.Identity("Obsession", 2025, "movie"), languages=("en",)))
