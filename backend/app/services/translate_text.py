"""Turn a subtitle cue into plain text for the translator and back. Pure functions."""

import re
from dataclasses import dataclass

_TAGS = re.compile(r"<[^>]+>|\{\\[^}]*\}")
RTL_EMBED = "‫"  # keeps punctuation on the correct side in right-to-left players


@dataclass(frozen=True)
class Prepared:
    core: str


def prepare(raw: str) -> Prepared:
    """What the model sees for one cue: markup removed, lines joined."""
    return Prepared(" ".join(_TAGS.sub("", raw).split()))


def restore(prepared: Prepared, translated: str, rtl: bool) -> str:
    """The text to write back for one cue."""
    if not translated.strip():
        return ""
    return (RTL_EMBED if rtl else "") + translated.strip()
