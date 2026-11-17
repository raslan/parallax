"""Release kinds, season-pack member picking and candidate ranking (pure functions)."""

import pytest

from app.services.subtitle_candidates import (
    parse_member_marker,
    parse_release_marker,
    pick_member,
    rank_candidates,
    release_kind,
    unsupported_format_reason,
)

EPISODE_NAMES = [
    "Stranger.Things.S01E01.720p.WEBRip.x264-SKGTV",
    "Breaking Bad s01e01 720p.BRrip.Sujaidr",
    "Breaking Bad S1E01 - Pilot .BluRay 720P. SUP",
    "Show.S01E01E02.720p",
    "Show.S01E01-E03.720p",
    "Show 1x04",
]

PACK_NAMES = [
    "Stranger Things S01-S02-S03-S04 Web-dl Netflix",
    "Stranger Things Season 1 Complete 720p Bluray",
    "Breaking.Bad.S01.S02.S03.S04",
    "Breaking Bad COMPLETE S01-S05 2160p",
    "game-of-thrones-first-season-1",
    "Breaking Bad Season 1 (2160p x265 10bit Joy)",
    "Some Show 1080p WEB-DL",
]


@pytest.mark.parametrize("name", EPISODE_NAMES)
def test_kind_episode_names(name):
    assert release_kind(name) == "episode"


@pytest.mark.parametrize("name", PACK_NAMES)
def test_kind_season_pack_names(name):
    assert release_kind(name) == "season_pack"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Stranger Things S01E02 Chapter Two - The Weirdo on Maple Street ara.srt", (1, 2)),
        ("Breaking.Bad.S01E04.1080p.BluRay.x265-RARBG.srt", (1, 4)),
        ("Game_Of_Thrones_S1_E1.ass", (1, 1)),
        ("Game_Of_Thrones_S1_E10_End.ass", (1, 10)),
        ("Show 1x04.srt", (1, 4)),
        ("random.srt", None),
        ("Show.1920x1080.srt", None),
    ],
)
def test_member_marker_forms(name, expected):
    assert parse_member_marker(name) == expected
    assert parse_release_marker(name) == expected


STRANGER = [
    "Stranger Things S01E08 Chapter Eight - The Upside Down ara.srt",
    "Stranger Things S01E07 Chapter Seven - The Bathtub ara.srt",
    "Stranger Things S01E02 Chapter Two - The Weirdo on Maple Street ara.srt",
    "Stranger Things S01E03 Chapter Three - Holly, Jolly ara.srt",
    "Stranger Things S01E01 Chapter One - The Vanishing of Will Byers ara.srt",
]
BREAKING = [f"Breaking.Bad.S01E0{n}.1080p.BluRay.x265-RARBG.srt" for n in range(1, 8)]
THRONES = [f"Game_Of_Thrones_S1_E{n}.ass" for n in range(1, 6)]


def test_pick_member():
    member, reason = pick_member(STRANGER, 1, 1)
    assert member == STRANGER[-1] and reason is None
    member, reason = pick_member(BREAKING, 1, 5)
    assert member == "Breaking.Bad.S01E05.1080p.BluRay.x265-RARBG.srt" and reason is None
    assert pick_member(BREAKING, 1, 9) == (None, "This pack has no file for S01E09")
    member, reason = pick_member(THRONES, 1, 3)
    assert member == "Game_Of_Thrones_S1_E3.ass" and reason is None


def test_pick_member_ambiguity_and_format_preference():
    twice = ["a S01E02 one.srt", "b S01E02 two.srt", "c S01E03.srt"]
    assert pick_member(twice, 1, 2) == (None, "This pack has more than one file for S01E02")
    mixed = ["x S01E02.ass", "x S01E02.srt", "x S01E03.srt"]
    assert pick_member(mixed, 1, 2) == ("x S01E02.srt", None)
    two_ass = ["x S01E02.ass", "y S01E02.ass", "x S01E03.srt"]
    member, reason = pick_member(two_ass, 1, 2)
    assert member is None and reason == "This pack has more than one file for S01E02"


def test_pick_member_multi_episode_member_covers_both():
    names = ["Show.S01E01E02.srt", "Show.S01E03.srt"]
    assert pick_member(names, 1, 2) == ("Show.S01E01E02.srt", None)


def test_unsupported_format_reason():
    assert (
        unsupported_format_reason(".ass")
        == "This pack's files are .ass, which this page cannot read yet"
    )


def _cand(release, score, **extra):
    return {
        "provider": "subf2m",
        "subtitle_id": release,
        "release": release,
        "score": score,
        **extra,
    }


def test_rank_episode_before_season_pack_even_at_lower_score():
    pack = _cand("Show S01-S02-S03-S04 Web-dl", 80)
    ep = _cand("Show.S01E01.720p.WEB", 50)
    ranked = rank_candidates([pack, ep], None)
    assert [c["release"] for c in ranked] == [ep["release"], pack["release"]]


def test_rank_release_match_beats_score_among_episodes():
    video = "Show.S01E01.1080p.BluRay.x264-GRP.mkv"
    higher = _cand("Show.S01E01.720p.WEB.x264-XYZ", 80)
    matching = _cand("Show.S01E01.1080p.BluRay.x264-GRP", 20)
    ranked = rank_candidates([higher, matching], video)
    assert ranked[0]["release"] == matching["release"]


def test_rank_fewer_conflicts_wins_when_matches_equal():
    video = "Show.S01E01.1080p.BluRay.x264-GRP.mkv"
    conflicting = _cand("Show.S01E01.720p.WEB.x264-XYZ", 80)
    neutral = _cand("Show S01E01", 50)
    ranked = rank_candidates([conflicting, neutral], video)
    assert ranked[0]["release"] == neutral["release"]


def test_rank_is_stable_and_pure():
    a = _cand("Show.S01E01.A", 50)
    b = _cand("Show.S01E01.B", 50)
    original = [a, b]
    ranked = rank_candidates(original, None)
    assert ranked == [a, b]
    assert original == [a, b] and ranked is not original
    assert "release_kind" not in a


def test_rank_uses_stored_kind_when_present():
    ep = _cand("Odd name", 10, release_kind="episode")
    pack = _cand("Odd S01E01", 90, release_kind="season_pack")
    assert rank_candidates([pack, ep], None)[0] is ep
