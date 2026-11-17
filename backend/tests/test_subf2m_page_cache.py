"""A show's searches share subf2m pages instead of fetching the same one per episode."""

from app.services import subf2m_provider as sp


def test_same_page_is_fetched_once(monkeypatch):
    monkeypatch.setattr(sp, "_page_cache", {})
    fetched: list[str] = []

    def fake_get_text(self, url, retry=3):
        fetched.append(url)
        return "<html>page</html>"

    monkeypatch.setattr(sp.Subf2mProvider, "_get_text", fake_get_text)
    p = sp.Subf2mProvider()
    for _ in range(5):  # five episodes of one season
        p._get_page("https://subf2m.co/subtitles/show-first-season/english")
    p._get_page("https://subf2m.co/subtitles/show-first-season/arabic")
    assert fetched == [
        "https://subf2m.co/subtitles/show-first-season/english",
        "https://subf2m.co/subtitles/show-first-season/arabic",
    ]


def test_empty_page_is_not_cached(monkeypatch):
    monkeypatch.setattr(sp, "_page_cache", {})
    calls = []

    def fake_get_text(self, url, retry=3):
        calls.append(url)
        return ""

    monkeypatch.setattr(sp.Subf2mProvider, "_get_text", fake_get_text)
    p = sp.Subf2mProvider()
    p._get_page("https://subf2m.co/x")
    p._get_page("https://subf2m.co/x")
    assert len(calls) == 2
