import pytest
import requests

from app.services.subf2m_provider import Subf2mProvider, _season_slug_path
from app.services.subtitle_providers import Identity, ProviderError, SearchQuery


def test_season_slug_path_uses_ordinal_word():
    assert _season_slug_path("Stranger Things", 1) == "/subtitles/stranger-things-first-season"
    assert _season_slug_path("Stranger Things", 4) == "/subtitles/stranger-things-fourth-season"


def test_season_slug_path_strips_punctuation():
    assert _season_slug_path("Marvel's Agents of S.H.I.E.L.D.", 2) == (
        "/subtitles/marvels-agents-of-s-h-i-e-l-d-second-season"
    )


def test_season_slug_path_none_when_season_out_of_range():
    assert _season_slug_path("Show", 0) is None
    assert _season_slug_path("Show", 99) is None


def _http_500(*_a, **_k):
    raise requests.HTTPError("500 Server Error")


def test_tv_search_falls_back_to_slug_when_search_endpoint_errors(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(p, "_gen_results", _http_500)
    assert p._search_tv_show_season("Stranger Things", 1) == [
        "/subtitles/stranger-things-first-season"
    ]


def test_tv_search_falls_back_to_slug_when_search_finds_nothing(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(p, "_gen_results", lambda _q: iter(()))
    assert p._search_tv_show_season("Stranger Things", 2) == [
        "/subtitles/stranger-things-second-season"
    ]


def test_tv_search_prefers_real_results_over_slug(monkeypatch):
    class _A:
        text = "Stranger Things - First Season"

        def get(self, _k):
            return "/subtitles/stranger-things-first-season-2016"

    p = Subf2mProvider()
    monkeypatch.setattr(p, "_gen_results", lambda _q: iter([_A()]))
    assert p._search_tv_show_season("Stranger Things", 1) == [
        "/subtitles/stranger-things-first-season-2016"
    ]


def _query(path, kind="movie"):
    return SearchQuery(
        identity=Identity("Guess", None, kind, subf2m_path=path),
        languages=("en",),
        season=1,
        episode=1,
        video_path=None,
    )


def test_search_uses_the_pasted_page_and_does_not_title_search(monkeypatch):
    p = Subf2mProvider()

    def no_search(*_a, **_k):
        raise AssertionError("title search must not run")

    monkeypatch.setattr(p, "_gen_results", no_search)
    seen = []

    def page(path, lang):
        seen.append(path)
        return []

    monkeypatch.setattr(p, "_find_movie_subtitles", page)
    assert p.search(_query("/subtitles/obsession-2025")) == []
    assert seen == ["/subtitles/obsession-2025"]


def test_search_rejects_a_foreign_or_odd_pasted_path():
    p = Subf2mProvider()
    for bad in (
        "https://evil.com/subtitles/x",
        "//evil.com/subtitles/x",
        "/other/x",
        "/subtitles/..",
    ):
        with pytest.raises(ProviderError, match="Not a Subf2m page"):
            p.search(_query(bad))


def test_a_row_with_several_release_names_keeps_only_the_first(monkeypatch):
    p = Subf2mProvider()
    blob = "Movie.2025.1080p.BluRay-AAA\nMovie.2025.WEB-BBB\nfollow my channel for more"
    monkeypatch.setattr(
        p,
        "_find_movie_subtitles",
        lambda path, lang: [
            {"page_link": "https://subf2m.co/x", "release_info": blob, "score": 50}
        ],
    )
    (hit,) = p.search(_query("/subtitles/movie-2025"))
    assert hit["release"] == "Movie.2025.1080p.BluRay-AAA"


def test_release_names_have_their_html_entities_unescaped(monkeypatch):
    p = Subf2mProvider()
    monkeypatch.setattr(
        p,
        "_find_movie_subtitles",
        lambda path, lang: [
            {
                "page_link": "https://subf2m.co/x",
                "release_info": "Movie.2025.1080p &amp; 720p.BluRay-AAA",
                "score": 50,
            }
        ],
    )
    (hit,) = p.search(_query("/subtitles/movie-2025"))
    assert hit["release"] == "Movie.2025.1080p & 720p.BluRay-AAA"


def test_episode_filter_reads_the_shared_marker_parser():
    from app.services.subf2m_provider import _episode_from_release

    assert _episode_from_release("Show.S01E02.720p") == {"season": [1], "episode": [2]}
    assert _episode_from_release("Show.S01E01-E03.720p") == {"season": [1], "episode": [1, 2, 3]}
    # A pack of several seasons carries no episode, so the season filter can keep it.
    assert _episode_from_release("Stranger Things S01-S02-S03-S04 Web-dl") is None
    assert _episode_from_release("Show.1920x1080") is None
