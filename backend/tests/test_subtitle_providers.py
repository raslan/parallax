"""Provider interface, politeness, and parsers against saved site pages."""

import io as _io
import threading
import time
import zipfile as _zipfile
from pathlib import Path

import pytest
import pytest as _pytest

from app.services import subf2m_provider as _sf
from app.services import subtitle_providers as sp
from app.services import ytssubs_provider as _yts
from app.services.subf2m_provider import Subf2mProvider
from app.services.subtitle_providers import ProviderError as _PE
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


def test_yts_search_empty_page_is_not_drift(monkeypatch):
    p = YtsSubsProvider()
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: _page("yts_search_empty.html"))
    assert p.search_titles("zzqxqzzqxq") == []


def test_yts_unknown_film_404_page_is_empty(monkeypatch):
    # The site answers 404 for an unknown IMDB id; _get_text turns that into "".
    p = YtsSubsProvider()
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: "")
    assert p.search(_query(identity=sp.Identity("X", None, "movie", imdb_id="tt0000001"))) == []


def test_yts_film_page_without_subtitle_table_is_empty_not_drift(monkeypatch):
    # No saved page of a film with zero subtitles exists (none could be found), so
    # this is the real film page with only its subtitle table cut out.
    html = _page("yts_movie.html")
    start = html.index('<table class="table other-subs">')
    html = html[:start] + html[html.index("</table>", start) + len("</table>") :]
    p = YtsSubsProvider()
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: html)
    assert p.search(_query()) == []


def test_subf2m_language_page_with_no_subtitles_is_empty(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: _page("subf2m_movie_empty.html"))
    assert p._find_movie_subtitles("/subtitles/obsession-2025", "ja") == []


def test_subf2m_search_keeps_results_when_one_language_drifts(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(p, "_search_movie", lambda *_a, **_k: ["/subtitles/obsession-2025"])
    good = _page("subf2m_movie.html")

    def fake(url, **_k):
        return "<html></html>" if url.endswith("/arabic") else good

    monkeypatch.setattr(p, "_get_text", fake)
    q = _query(identity=sp.Identity("Obsession", 2025, "movie"), languages=("en", "ar"))
    results = p.search(q)
    assert results and {r["language"] for r in results} == {"en"}


def test_subf2m_search_raises_when_every_language_drifts(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(p, "_search_movie", lambda *_a, **_k: ["/subtitles/obsession-2025"])
    monkeypatch.setattr(p, "_get_text", lambda url, **_k: "<html></html>")
    q = _query(identity=sp.Identity("Obsession", 2025, "movie"), languages=("en", "ar"))
    with pytest.raises(sp.ProviderError, match=r"ul\.sublist"):
        p.search(q)


def _video(tmp_path):
    video = tmp_path / "Movie (2020).mkv"
    video.write_bytes(b"x")
    return str(video)


def test_search_file_route_unknown_provider_is_422(client, tmp_path):
    r = client.post(
        "/api/subtitles/search-file", json={"file_path": _video(tmp_path), "provider": "bogus"}
    )
    assert r.status_code == 422
    assert "Unknown source" in r.json()["detail"]


def test_download_one_route_unknown_provider_is_422(client, tmp_path):
    r = client.post(
        "/api/subtitles/download-one",
        json={
            "file_path": _video(tmp_path),
            "provider": "bogus",
            "subtitle_id": "x",
            "language": "en",
        },
    )
    assert r.status_code == 422
    assert "Unknown source" in r.json()["detail"]


def test_search_file_route_surfaces_provider_error(client, tmp_path, monkeypatch):
    def boom(self, q):
        raise sp.ProviderError("Subf2m page changed: nothing matched ul.sublist")

    monkeypatch.setattr(Subf2mProvider, "search", boom)
    r = client.post("/api/subtitles/search-file", json={"file_path": _video(tmp_path)})
    assert r.status_code == 502
    assert "ul.sublist" in r.json()["detail"]


# --- download ids are confined to the provider's own site (no outbound request otherwise) ---

_FOREIGN = [
    "https://evil.example/x",
    "https://subf2m.co.evil.com/x",
    "https://subf2m.co@evil.com/x",
    "http://subf2m.co/x",
    "file:///etc/passwd",
    "//evil.example/x",
    "@evil.com/x",
    "subtitles/relative-without-slash",
    "",
]


@_pytest.mark.parametrize("bad", _FOREIGN)
def test_subf2m_download_refuses_foreign_ids(monkeypatch, bad):
    p = _sf.Subf2mProvider()
    calls = []
    monkeypatch.setattr(p, "_get_text", lambda *a, **k: calls.append(a) or "")
    monkeypatch.setattr(p._session, "get", lambda *a, **k: calls.append(a))
    with _pytest.raises(_PE, match="Not a subtitle from this source"):
        p.download(bad)
    assert calls == []


@_pytest.mark.parametrize("ok", ["/subtitles/a/b/c", "https://subf2m.co/subtitles/a/b/c"])
def test_subf2m_download_accepts_own_ids(monkeypatch, ok):
    p = _sf.Subf2mProvider()
    seen = []
    monkeypatch.setattr(p, "_get_text", lambda url, *a, **k: seen.append(url) or "")
    assert p.download(ok) is None
    assert seen == ["https://subf2m.co/subtitles/a/b/c"]


@_pytest.mark.parametrize(
    "bad",
    [
        "@evil.com/x",
        "https://evil.example/x",
        "//evil.example/x",
        "file:///etc/passwd",
        ".evil.com/x",
        "movie/x",
        "",
    ],
)
def test_yts_download_refuses_foreign_ids(monkeypatch, bad):
    p = _yts.YtsSubsProvider()
    calls = []
    monkeypatch.setattr(p, "_get_text", lambda *a, **k: calls.append(a) or "")
    with _pytest.raises(_PE, match="Not a subtitle from this source"):
        p.download(bad)
    assert calls == []


def test_yts_download_accepts_own_id(monkeypatch):
    p = _yts.YtsSubsProvider()
    seen = []
    monkeypatch.setattr(p, "_get_text", lambda url, *a, **k: seen.append(url) or "")
    assert p.download("/subtitles/foo-en-1") is None
    assert seen == ["https://yts-subs.com/subtitles/foo-en-1"]


def test_archive_member_over_cap_is_refused_honest_bomb():
    buf = _io.BytesIO()
    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("a.srt", b"\0" * (8 * 1024 * 1024))
    assert len(buf.getvalue()) < 100_000
    with _pytest.raises(_PE, match="too large"):
        _sf._extract_from_archive(buf.getvalue())


def test_archive_small_member_still_extracted():
    buf = _io.BytesIO()
    with _zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a.srt", b"1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    assert b"Hi" in _sf._extract_from_archive(buf.getvalue())
