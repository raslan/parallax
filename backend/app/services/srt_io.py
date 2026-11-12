"""Read and write SubRip (.srt) text. Pure functions, no I/O."""

import re
from dataclasses import dataclass

_CUE = re.compile(
    r"(?:^|\n)\s*\d+[ \t]*\n"
    r"(\d\d):(\d\d):(\d\d)[,.](\d{1,3}) --> (\d\d):(\d\d):(\d\d)[,.](\d{1,3})[^\n]*\n"
    # a cue ends at a blank line, or (malformed files) where the next cue's header begins
    r"(.*?)(?=\n\s*\n|\n\d+[ \t]*\n\d\d:\d\d:\d\d[,.]\d{1,3} -->|\Z)",
    re.S,
)


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def _seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def decode_srt(data: bytes) -> str:
    """Subtitle files come in UTF-8 (with or without a BOM) or an older single-byte code page
    (Latin-1 / Windows-1252, common for European subtitles). UTF-8 is tried first, then
    Windows-1252, so an accented letter is not turned into a replacement character."""
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8-sig", errors="replace")  # cp1252 leaves a few bytes undefined


def parse_srt(text: str) -> list[Cue]:
    """Cues in file order. Index numbers are ignored (renumbered on write); anything that
    is not a cue block is skipped."""
    # a stray blank line before the byte-order mark (seen in the wild) must not hide cue 1
    text = text.lstrip("\ufeff \t\r\n").replace("\r\n", "\n").replace("\r", "\n")
    cues = []
    for m in _CUE.finditer(text.rstrip() + "\n"):
        cues.append(
            Cue(
                _seconds(*m.group(1, 2, 3, 4)),
                _seconds(*m.group(5, 6, 7, 8)),
                m.group(9).strip("\n"),
            )
        )
    return cues


def format_timestamp(t: float) -> str:
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(cues: list[Cue]) -> str:
    blocks = [
        f"{i}\n{format_timestamp(c.start)} --> {format_timestamp(c.end)}\n{c.text}\n"
        for i, c in enumerate(cues, 1)
    ]
    return "\n".join(blocks) + "\n"
