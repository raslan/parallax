"""Identity: pasted ids and links, title grouping of a folder, TMDB year, routes."""

import pytest

from app.services import subtitle_identity as si
from app.services import tmdb


@pytest.fixture(autouse=True)
def _no_tmdb(monkeypatch):
    monkeypatch.setattr(si, "_tmdb_key", lambda: "")


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    return str(path)


def test_parse_pasted_imdb_id_and_urls():
    assert si.parse_pasted("tt37287335") == {"imdb_id": "tt37287335"}
    assert si.parse_pasted("  tt37287335 ") == {"imdb_id": "tt37287335"}
    assert si.parse_pasted("https://www.imdb.com/title/tt37287335/?ref_=x") == {
        "imdb_id": "tt37287335"
    }
    assert si.parse_pasted("https://subf2m.co/subtitles/stranger-things-fifth-season") == {
        "subf2m_path": "/subtitles/stranger-things-fifth-season"
    }
    assert si.parse_pasted("https://yts-subs.com/movie-imdb/tt37287335") == {
        "imdb_id": "tt37287335"
    }


@pytest.mark.parametrize(
    "text", ["", "hello", "https://example.com/x", "https://subf2m.co/", "tt12", "ttabc"]
)
def test_parse_pasted_rejects_garbage(text):
    with pytest.raises(ValueError, match="Not an IMDB id or a supported link"):
        si.parse_pasted(text)


def test_suggest_groups_clean_movie_layout(tmp_path):
    root = tmp_path / "Movies"
    f = _touch(root / "Obsession (2025)" / "Obsession (2025).mkv")
    groups = si.suggest_groups(str(root), [f])
    assert len(groups) == 1
    g = groups[0]
    assert g["title"] == "Obsession"
    assert g["year"] == 2025
    assert g["type"] == "movie"
    assert g["layout_clean"] is True
    assert g["needs_choice"] is False
    assert g["files"] == [f]


def test_suggest_groups_clean_tv_layout(tmp_path):
    root = tmp_path / "Shows"
    files = [
        _touch(root / "Stranger Things" / "Season 01" / f"Stranger Things - S01E0{n} - X.mkv")
        for n in (1, 2, 3)
    ]
    groups = si.suggest_groups(str(root), files)
    assert len(groups) == 1
    g = groups[0]
    assert g["type"] == "tv"
    assert g["title"] == "Stranger Things"
    assert g["layout_clean"] is True
    assert sorted(g["files"]) == sorted(files)


def test_suggest_groups_messy_names_do_not_merge(tmp_path):
    a = _touch(tmp_path / "Inception.2010.1080p.BluRay.x264-GRP.mkv")
    b = _touch(tmp_path / "The.Matrix.1999.720p.WEB.x264-GRP.mkv")
    groups = si.suggest_groups(str(tmp_path), [a, b])
    assert len(groups) == 2
    assert all(g["layout_clean"] is False for g in groups)
    assert {g["title"] for g in groups} == {"Inception", "The Matrix"}


def test_suggest_groups_stem_prefix_not_confused(tmp_path):
    a = _touch(tmp_path / "Movie.mkv")
    b = _touch(tmp_path / "Movie 2.mkv")
    groups = si.suggest_groups(str(tmp_path), [a, b])
    assert len(groups) == 2
    assert sorted(len(g["files"]) for g in groups) == [1, 1]


def test_suggest_groups_title_from_folder_when_name_has_none(tmp_path):
    f = _touch(tmp_path / "Blade Runner (1982)" / "1982.mkv")
    groups = si.suggest_groups(str(tmp_path), [f])
    assert len(groups) == 1
    assert groups[0]["title"] == "Blade Runner"


def test_suggest_groups_needs_choice_only_with_tmdb_and_differing_years(tmp_path, monkeypatch):
    f = _touch(tmp_path / "Obsession.mkv")
    monkeypatch.setattr(si, "_tmdb_key", lambda: "k")
    monkeypatch.setattr(
        tmdb,
        "search",
        lambda q, t, key, year=None: [{"year": 2024}, {"year": 2025}],
    )
    assert si.suggest_groups(str(tmp_path), [f])[0]["needs_choice"] is True

    monkeypatch.setattr(tmdb, "search", lambda q, t, key, year=None: [{"year": 2025}])
    assert si.suggest_groups(str(tmp_path), [f])[0]["needs_choice"] is False

    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(tmdb, "search", boom)
    assert si.suggest_groups(str(tmp_path), [f])[0]["needs_choice"] is False

    monkeypatch.setattr(si, "_tmdb_key", lambda: "")
    assert si.suggest_groups(str(tmp_path), [f])[0]["needs_choice"] is False


def test_suggest_groups_does_not_ask_tmdb_when_year_known(tmp_path, monkeypatch):
    f = _touch(tmp_path / "Obsession (2025).mkv")
    monkeypatch.setattr(si, "_tmdb_key", lambda: "k")

    def boom(*a, **k):
        raise AssertionError("TMDB must not be asked")

    monkeypatch.setattr(tmdb, "search", boom)
    assert si.suggest_groups(str(tmp_path), [f])[0]["needs_choice"] is False


class _Resp:
    def __init__(self):
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"results": []}


@pytest.mark.parametrize("kind,param", [("movie", "year"), ("tv", "first_air_date_year")])
def test_tmdb_search_sends_year(monkeypatch, kind, param):
    seen = {}

    def fake_get(url, params=None, timeout=None):
        seen.update(params)
        return _Resp()

    monkeypatch.setattr(tmdb.requests, "get", fake_get)
    tmdb.search("X", kind, "k", year=2005)
    assert seen[param] == 2005

    seen.clear()
    tmdb.search("X", kind, "k")
    assert "year" not in seen and "first_air_date_year" not in seen


def test_groups_route_requires_directory(client, tmp_path):
    r = client.post("/api/subtitles/groups", json={"path": str(tmp_path / "nope")})
    assert r.status_code == 400


def test_groups_route_walks_folder(client, tmp_path):
    _touch(tmp_path / "Obsession (2025)" / "Obsession (2025).mkv")
    _touch(tmp_path / "Obsession (2025)" / "notes.txt")
    r = client.post("/api/subtitles/groups", json={"path": str(tmp_path)})
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_parse_route(client):
    ok = client.post("/api/subtitles/identity/parse", json={"text": "tt37287335"})
    assert ok.status_code == 200 and ok.json() == {"imdb_id": "tt37287335"}
    bad = client.post("/api/subtitles/identity/parse", json={"text": "nope"})
    assert bad.status_code == 422
    assert "Not an IMDB id" in bad.text


def test_yts_route(client, monkeypatch):
    from app.services import ytssubs_provider

    monkeypatch.setattr(
        ytssubs_provider.YtsSubsProvider,
        "search_titles",
        lambda self, q: [{"title": q, "year": 2025, "imdb_id": "tt1", "poster_url": None}],
    )
    r = client.post("/api/subtitles/identity/yts", json={"query": "obsession"})
    assert r.status_code == 200
    assert r.json()[0]["imdb_id"] == "tt1"
