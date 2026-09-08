from app.services.nfo import build_episode_nfo, build_tvshow_nfo, normalize_date


def test_normalize_date_accepts_ytdlp_and_iso_and_rejects_junk():
    assert normalize_date("20070725") == "2007-07-25"
    assert normalize_date("2007-07-25T00:00:00.000000Z") == "2007-07-25"
    assert normalize_date("2007-07-25") == "2007-07-25"
    assert normalize_date(None) is None
    assert normalize_date("last thursday") is None
    assert normalize_date("2007") is None


def test_episode_nfo_escapes_and_includes_core_fields():
    xml = build_episode_nfo(
        title="Painkiller & <Harry>",
        show_title="Zero Punctuation",
        season=1,
        episode=3,
        aired="2007-08-01",
        plot="A review.",
    )
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    assert "<episodedetails>" in xml
    assert "<title>Painkiller &amp; &lt;Harry&gt;</title>" in xml
    assert "<season>1</season>" in xml
    assert "<episode>3</episode>" in xml
    assert "<aired>2007-08-01</aired>" in xml
    assert "<year>2007</year>" in xml
    assert "<studio>YouTube</studio>" in xml


def test_episode_nfo_omits_optional_fields_when_absent():
    xml = build_episode_nfo(
        title="Ep", show_title="Show", season=2, episode=5, aired=None, plot=None
    )
    assert "<aired>" not in xml
    assert "<plot>" not in xml


def test_tvshow_nfo_carries_premiered_and_derived_year():
    xml = build_tvshow_nfo(title="Zero Punctuation", premiered="2007-07-25")
    assert "<tvshow>" in xml
    assert "<title>Zero Punctuation</title>" in xml
    assert "<premiered>2007-07-25</premiered>" in xml
    assert "<year>2007</year>" in xml
