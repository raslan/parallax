"""Turn a subtitle cue into plain text for the translator and back. Pure functions.

Everything here works from the subtitle itself, with no outside knowledge of the film.
Proven by measurement (RAS-124): keeping the music markers aside and folding characters the
model's vocabulary lacks takes the unknown-token markers in a full film from 5 to 0.
"""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass

_TAGS = re.compile(r"<[^>]+>|\{\\[^}]*\}")
RTL_EMBED = "‫"  # keeps punctuation on the correct side in right-to-left players
UNKNOWN_MARK = "⁇"  # what a model writes for a character it has no token for

# "(DISTANT EXPLOSION)", "[MUSIC PLAYING]": sound notes for the hard of hearing. Only an
# all-capitals note counts, so "(quietly)" in running speech is left alone.
_SOUND = re.compile(r"[(\[][^()\[\]a-z]*[)\]]")
# "FURY:", "- NICK:" at the start of a cue: a speaker label, again capitals only.
_SPEAKER = re.compile(r"^(?:[-–]\s*)?[A-Z][A-Z0-9 .'#\-]{0,30}\s*:\s*")

_MUSIC = "♪♫♬#*"  # ♪ ♫ ♬ and the "#" / "*" some subtitles use for song lines
_MUSIC_EDGE = re.compile(rf"^([\s{re.escape(_MUSIC)}]*)(.*?)([\s{re.escape(_MUSIC)}]*)$", re.S)


@dataclass(frozen=True)
class Prepared:
    pre: str  # music markers before the words ("♪♪ ")
    core: str  # what the model translates
    post: str  # music markers after the words (" ♪♪")


def prepare(raw: str, drop_hi: bool = False) -> Prepared:
    """What the model sees for one cue: markup removed, lines joined, music markers set aside.

    Sound notes and speaker labels are kept and translated unless `drop_hi` is set."""
    text = " ".join(_TAGS.sub("", raw).split())
    if drop_hi:
        text = " ".join(_SOUND.sub(" ", text).split())
        text = _SPEAKER.sub("", text).strip()
    pre, core, post = _MUSIC_EDGE.match(text).groups()  # type: ignore[union-attr]
    return Prepared(
        pre.strip() + " " if pre.strip() else "",
        core,
        " " + post.strip() if post.strip() else "",
    )


def restore(prepared: Prepared, translated: str, rtl: bool) -> str:
    """The text to write back for one cue."""
    # The model writes U+2047 for a character it cannot produce (the "×" in "4 × 400"). Never
    # leave that marker in a subtitle.
    words = " ".join(translated.replace(UNKNOWN_MARK, " ").split())
    if not words:
        # A music-only cue keeps its markers; a spoken cue the model returned nothing for is empty.
        body = (prepared.pre + prepared.post).strip() if not prepared.core.strip() else ""
    else:
        body = prepared.pre + words + prepared.post
    if not body:
        return ""
    return (RTL_EMBED if rtl else "") + body


def fold_unknown(text: str, is_unknown: Callable[[str], bool]) -> str:
    """Replace characters the model's vocabulary lacks (ö, é, curly quotes...) by a plain
    look-alike, or drop them, so they do not come out as a U+2047 in the translation.
    `is_unknown(s)` says whether the tokenizer maps anything in `s` to its unknown token."""
    if not is_unknown(text):
        return text
    out = []
    for ch in text:
        if is_unknown(ch):
            ch = "".join(c for c in unicodedata.normalize("NFKD", ch) if ord(c) < 128)
            if is_unknown(ch):  # no look-alike the model knows (a stray "^", say): drop it
                ch = ""
        out.append(ch)
    return "".join(out)
