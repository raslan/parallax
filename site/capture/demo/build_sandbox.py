#!/usr/bin/env python3
"""Build pristine/organize-sandbox/ — the messy tree the Organize page is captured against.

    python3 -P site/capture/demo/build_sandbox.py [--force]

Only reuses small files already in pristine/ (4 KB placeholders, 40-55 KB JPGs, 5 s audio cuts,
one 2 MB clip). Real copies, never hard links: stamping mtimes on a link would change the originals.
Shows: repeated name groups (chips), camera-style names (rename), loose files (move to subfolder /
folder), junk text files, samples, and several empty folders (empty-folder prompt).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# The tooling is committed (site/capture/demo/); the media stays in the gitignored docs/demo/.
HERE = Path(__file__).resolve().parents[3] / "docs" / "demo"
PRISTINE = HERE / "pristine"
ROOT = PRISTINE / "organize-sandbox"

MP4 = next((PRISTINE / "identify-incoming" / "Backyard Astronomy").glob("*.mp4"))
MKV = next((PRISTINE / "identify-incoming").glob("Pioneer*/*.mkv"))
JPGS = sorted((PRISTINE / "images" / "Small").glob("*.jpg"))
CLIP = PRISTINE / "videos" / "Clips" / "Sintel Timelapse (15fps).mp4"
SRT = PRISTINE / "videos" / "Movies" / "Sintel (2010).en.srt"
MP3S = {p.stem: p for p in (PRISTINE / "audio" / "Kevin MacLeod").glob("*.mp3") if "128k" not in p.name}

_i = 0


def when() -> datetime:
    """Deterministic spread of dates across 2019-2025."""
    global _i
    _i += 1
    return datetime(2019 + (_i * 7) % 7, 1 + (_i * 5) % 12, 1 + (_i * 11) % 27, 12, tzinfo=timezone.utc)


def put(src: Path, rel: str) -> None:
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out)
    ts = when().timestamp()
    os.utime(out, (ts, ts))


def text(rel: str, body: str) -> None:
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    ts = when().timestamp()
    os.utime(out, (ts, ts))


def audio_cut(name: str, src: Path, start: int, rel: str) -> None:
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", "5", "-i", str(src),
                    "-map_metadata", "0", "-c", "copy", str(out)], check=True)
    ts = when().timestamp()
    os.utime(out, (ts, ts))


def main() -> None:
    if ROOT.exists():
        if "--force" not in sys.argv:
            sys.exit(f"{ROOT} exists (use --force to rebuild)")
        shutil.rmtree(ROOT)

    # Inbox: the unsorted pile. Several repeated name groups so the name chips have something to find.
    for n in range(1, 7):
        put(MP4, f"Inbox/Backyard Astronomy S01E{n:02d}.mp4")
    for n in range(1, 9):
        put(JPGS[n % len(JPGS)], f"Inbox/Holiday 2023 - {n:02d}.jpg")
    for n in range(1001, 1007):  # camera-style names: the rename demo
        put(JPGS[n % len(JPGS)], f"Inbox/IMG_{n}.jpg")
    for n in range(1, 6):
        audio_cut("memo", MP3S["Anguish"], 20 * n, f"Inbox/Voice Memo {n:03d}.mp3")
    for n in range(1, 4):
        put(MKV, f"Inbox/Pioneer One - Extra {n}.mkv")
    text("Inbox/readme.txt", "Downloaded 2021-03-04\nSee the folders for details.\n")
    text("Inbox/Season 1 Complete.nfo", "Backyard Astronomy - Season 1\nQuality: 720p\n")
    text("Inbox/notes - old.txt", "todo: sort these\n")

    # Sorted: what a tidy library looks like (also shows folder cards with sizes/counts).
    put(MKV, "Sorted/Movies/Sintel (2010)/Sintel (2010).mkv")
    put(SRT, "Sorted/Movies/Sintel (2010)/Sintel (2010).en.srt")
    put(CLIP, "Sorted/Movies/Tears of Steel (2012)/Tears of Steel (2012) - preview.mp4")
    for title, start in (("Anguish", 60), ("Disquiet", 40), ("Floating Cities", 30)):
        audio_cut(title, MP3S[title], start, f"Sorted/Music/Kevin MacLeod/{title}.mp3")
    for n in (1, 2, 3):
        put(JPGS[n % len(JPGS)], f"Sorted/Photos/2023/Holiday 2023 - {n:02d}.jpg")
    (ROOT / "Sorted/Photos/2024").mkdir(parents=True, exist_ok=True)  # empty

    # Samples and extras.
    for n in range(1, 4):
        put(MP4, f"Samples/Sample {n} - Backyard Astronomy.mp4")
    for n in range(1, 4):
        put(MP4, f"Extras/Behind the Scenes/Making of {n}.mp4")
    (ROOT / "Extras/Trailers").mkdir(parents=True, exist_ok=True)  # empty

    # Old backups: deep and mostly empty.
    for p in ("Old Backups/2019", "Old Backups/2020/Phone", "Old Backups/2020/Camera"):
        (ROOT / p).mkdir(parents=True, exist_ok=True)
    put(JPGS[0], "Old Backups/2020/Phone/IMG_0001.jpg")

    files = [p for p in ROOT.rglob("*") if p.is_file()]
    dirs = [p for p in ROOT.rglob("*") if p.is_dir()]
    empty = [p for p in dirs if not any(p.iterdir())]
    size = sum(p.stat().st_size for p in files)
    print(f"{len(files)} files, {len(dirs)} folders ({len(empty)} empty), {size / 1e6:.1f} MB at {ROOT}")


if __name__ == "__main__":
    main()
