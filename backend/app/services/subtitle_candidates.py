"""Which subtitle candidate is the right one (pure functions, no network, no DB).

One marker parser decides a release's kind (`episode` or `season_pack`), which archive member
is a given episode's file, and the provider's own episode filter, so the three never disagree.
"""

import re
from typing import Literal

ReleaseKind = Literal["episode", "season_pack"]

# S01E01, S1E01, S1_E01, s01.e01 and the multi-episode tails S01E01E02 / S01E01-E03.
_SXXEYY_RE = re.compile(
    r"(?<![a-z])s(?P<s>\d{1,2})[\s._-]*e(?P<e>\d{1,3})(?P<tail>(?:\s?[-–]?e\d{1,3})*)",
    re.IGNORECASE,
)
_TAIL_RE = re.compile(r"([-–]?)e(\d{1,3})", re.IGNORECASE)
# 1x04, never 1920x1080 (a digit or a letter before it rules it out).
_NXNN_RE = re.compile(r"(?<![0-9a-z])(?P<s>\d{1,2})x(?P<e>\d{2,3})(?![0-9])", re.IGNORECASE)


def parse_release_episodes(name: str) -> tuple[int, list[int]] | None:
    """(season, [episodes]) for the first season-and-episode marker in `name`, else None.
    `S01E01-E03` is episodes 1 to 3, `S01E01E02` is 1 and 2."""
    m = _SXXEYY_RE.search(name)
    if m:
        season, first = int(m.group("s")), int(m.group("e"))
        episodes = [first]
        for dash, num in _TAIL_RE.findall(m.group("tail") or ""):
            n = int(num)
            if dash and n > episodes[-1]:
                episodes.extend(range(episodes[-1] + 1, n + 1))
            else:
                episodes.append(n)
        return season, episodes
    m = _NXNN_RE.search(name)
    if m:
        return int(m.group("s")), [int(m.group("e"))]
    return None


def parse_release_marker(name: str) -> tuple[int, int] | None:
    """(season, first episode) of the marker in a release name, else None."""
    found = parse_release_episodes(name)
    return (found[0], found[1][0]) if found else None


def parse_member_marker(name: str) -> tuple[int, int] | None:
    """The same parser, applied to an archive member's file name."""
    return parse_release_marker(name)


def release_kind(release: str) -> ReleaseKind:
    """`episode` when the name carries one season-and-episode marker, else `season_pack`
    (a season, several seasons, a complete series, or no marker at all)."""
    return "episode" if parse_release_marker(release) else "season_pack"


def _is_srt(name: str) -> bool:
    return name.lower().endswith(".srt")


def pick_member(names: list[str], season: int, episode: int) -> tuple[str | None, str | None]:
    """The archive member that is this episode's subtitle: (member, None), or (None, reason).

    Exactly one `.srt` with the episode's marker wins; an `.srt` beats an `.ass` with the same
    marker; none, or several of the same format, is refused with a named message. Never "the
    first file". A lone matching non-`.srt` is returned and the caller refuses the format."""
    label = f"S{season:02d}E{episode:02d}"
    matching = []
    for name in names:
        found = parse_release_episodes(name)
        if found and found[0] == season and episode in found[1]:
            matching.append(name)
    if not matching:
        return None, f"This pack has no file for {label}"
    srts = [n for n in matching if _is_srt(n)]
    pool = srts or matching
    if len(pool) > 1:
        return None, f"This pack has more than one file for {label}"
    return pool[0], None


def unsupported_format_reason(ext: str) -> str:
    return f"This pack's files are {ext}, which this page cannot read yet"


def _rank_key(c: dict, index: int, video_name: str | None) -> tuple:
    kind = c.get("release_kind") or release_kind(c.get("release") or "")
    matches = conflicts = 0
    if video_name:
        from app.services.subtitle_preview import release_tokens

        for tok in release_tokens(c.get("release") or "", video_name).values():
            if tok["match"] is True:
                matches += 1
            elif tok["match"] is False:
                conflicts += 1
    return (0 if kind == "episode" else 1, -matches, conflicts, -(c.get("score") or 0), index)


def rank_candidates(candidates: list[dict], video_name: str | None) -> list[dict]:
    """A new list, best first: episode before season pack, then more release-token matches with
    the user's file, then fewer conflicts, then the community score, then the source's order."""
    order = sorted(range(len(candidates)), key=lambda i: _rank_key(candidates[i], i, video_name))
    return [candidates[i] for i in order]
