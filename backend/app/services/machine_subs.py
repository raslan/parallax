"""Naming of machine-made subtitles (offline translation, speech-to-text).

A machine-made subtitle is `<video stem>.<lang>.mt.srt` (`movie.ar.mt.srt`). The `mt` marker
keeps it apart from a real subtitle: the scan looks for exactly `<stem>.<lang>.<ext>`, so a
machine-made file never counts as "this language is done" and a real one can still be fetched.
"""

import os

MARKER = "mt"


def machine_sub_path(video_path: str, lang: str) -> str:
    """Where the machine-made `lang` subtitle of this video lives: next to the video."""
    stem, _ = os.path.splitext(video_path)
    return f"{stem}.{lang}.{MARKER}.srt"


def parse_tagged_suffix(suffix: str) -> tuple[str, bool]:
    """('ar.mt' -> ('ar', True)); ('en' -> ('en', False)). `suffix` is the part of a subtitle
    file name between the video stem and the extension."""
    parts = suffix.split(".")
    if len(parts) >= 2 and parts[-1].lower() == MARKER:
        return ".".join(parts[:-1]), True
    return suffix, False
