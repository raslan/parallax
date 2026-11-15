"""Naming of subtitle files: `<video stem>.<lang>[.hi][.<token>].srt`.

The text between the video name and the extension is a language followed by optional tokens:
`movie.en.srt`, `movie.ar.hi.srt` (hearing impaired), `movie.en.subf2m.srt` (a real subtitle
labelled with where it came from), `movie.en.generated.srt` (speech-to-text),
`movie.ar.translated.srt` (offline translation) and `movie.en.original.srt` (the backup a sync
leaves). `generated` and `translated` may carry a suffix (`generated-2`, `generated-turbo`).
Generated and translated files never count as a real subtitle; `original` files are backups
and are never listed. Tokens are matched case-insensitively and in any order.

The words are not language codes because players read a short token after the language as a
language of its own (`mt` is Maltese, `hi` is Hindi).
"""

import os
from dataclasses import dataclass

HI = "hi"
GENERATED = "generated"
TRANSLATED = "translated"
ORIGINAL = "original"


@dataclass(frozen=True)
class SubTag:
    lang: str
    hearing_impaired: bool
    machine_kind: str | None
    original: bool
    label: str | None

    @property
    def machine_made(self) -> bool:
        return self.machine_kind is not None

    @property
    def kind(self) -> str:
        if self.original:
            return "original"
        if self.machine_kind:
            return self.machine_kind
        if self.hearing_impaired:
            return "hearing_impaired"
        return "real"


def _machine_kind(token: str) -> str | None:
    t = token.lower()
    for word in (GENERATED, TRANSLATED):
        if t == word or t.startswith(word + "-"):
            return word
    return None


def parse_tag(suffix: str) -> SubTag:
    """'ar.hi.subf2m' -> SubTag('ar', True, None, False, 'subf2m'). `suffix` is the part of a
    subtitle file name between the video stem and the extension; empty means no language."""
    parts = [p for p in suffix.split(".") if p]
    if not parts:
        return SubTag("und", False, None, False, None)
    hi = False
    original = False
    machine_kind = None
    label = None
    for token in parts[1:]:
        low = token.lower()
        if low == HI:
            hi = True
        elif low == ORIGINAL:
            original = True
        elif kind := _machine_kind(token):
            machine_kind = machine_kind or kind
        elif label is None:
            label = token
    return SubTag(parts[0].lower(), hi, machine_kind, original, label)


def is_real(tag: SubTag) -> bool:
    """A subtitle that counts as "this language is done"."""
    return not tag.machine_made and not tag.original


def subtitle_path(
    video_path: str,
    lang: str,
    *,
    hearing_impaired: bool = False,
    token: str | None = None,
    ext: str = ".srt",
) -> str:
    stem, _ = os.path.splitext(video_path)
    parts = [lang, *([HI] if hearing_impaired else []), *([token] if token else [])]
    return f"{stem}.{'.'.join(parts)}{ext}"


def variant_path(
    video_path: str,
    lang: str,
    word: str,
    *,
    keep: bool,
    hearing_impaired: bool = False,
    ext: str = ".srt",
) -> str:
    """Where a `generated` / `translated` (or source-labelled) file goes. Without `keep` it is
    the plain name (an earlier one is overwritten); with `keep` the first of `word`, `word-2`,
    `word-3`... that does not exist yet with extension `ext`."""
    first = subtitle_path(video_path, lang, hearing_impaired=hearing_impaired, token=word, ext=ext)
    if not keep:
        return first
    n = 1
    path = first
    while os.path.exists(path):
        n += 1
        path = subtitle_path(
            video_path, lang, hearing_impaired=hearing_impaired, token=f"{word}-{n}", ext=ext
        )
    return path


def original_path(sub_path: str) -> str:
    """The sync backup beside a subtitle: `Movie.en.srt` -> `Movie.en.original.srt`."""
    stem, ext = os.path.splitext(sub_path)
    return f"{stem}.{ORIGINAL}{ext}"
