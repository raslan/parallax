"""Naming of subtitle files: language plus flags (hearing impaired, machine-made).

The text between the video name and the extension is a language and optional flags:
`movie.en.srt`, `movie.ar.hi.srt` (hearing impaired), `movie.ar.mt.srt` (machine-made, from
offline translation or speech-to-text), `movie.en.hi.mt.srt` (both). The scan looks for a
real subtitle, so a machine-made file never counts as "this language is done" and a real one
can still be fetched. Flags may come in any order and are matched case-insensitively.
"""

import os
from dataclasses import dataclass

MARKER = "mt"
HI = "hi"


@dataclass(frozen=True)
class SubTag:
    lang: str
    hearing_impaired: bool
    machine_made: bool


def machine_sub_path(video_path: str, lang: str) -> str:
    """Where the machine-made `lang` subtitle of this video lives: next to the video."""
    stem, _ = os.path.splitext(video_path)
    return f"{stem}.{lang}.{MARKER}.srt"


def parse_tag(suffix: str) -> SubTag:
    """'ar.hi.mt' -> SubTag('ar', True, True). `suffix` is the part of a subtitle file name
    between the video stem and the extension; empty means no language was written."""
    parts = [p for p in suffix.split(".") if p]
    if not parts:
        return SubTag("und", False, False)
    flags = {p.lower() for p in parts[1:]}
    return SubTag(parts[0].lower(), HI in flags, MARKER in flags)


def tag_text(lang: str, hearing_impaired: bool = False, machine_made: bool = False) -> str:
    """The inverse of `parse_tag`: 'ar', True, True -> 'ar.hi.mt'."""
    return ".".join(
        [lang, *([HI] if hearing_impaired else []), *([MARKER] if machine_made else [])]
    )
