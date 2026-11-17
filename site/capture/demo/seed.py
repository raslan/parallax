#!/usr/bin/env python3
"""Seed the running demo instance (idempotent). Usage: python3 -P site/capture/demo/seed.py [--url URL]

Reads TMDB_API_KEY from docs/demo/.env (never printed), sets key + theme, creates the three
libraries if missing and starts a scan of each, and points Organize at the media root.
Stdlib only. Paths are as seen *inside* the container (library/ is mounted at /media).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

# The tooling is committed (site/capture/demo/); .env stays in the gitignored docs/demo/.
HERE = Path(__file__).resolve().parents[3] / "docs" / "demo"
URL = (sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:7898").rstrip("/")

# (kind, API prefix, path inside container)
# The video create endpoint stores the name as given (the UI always sends one), so name them here.
LIBRARIES = [
    ("video", "/api/libraries", "/media/videos", "Videos"),
    ("image", "/api/image-libraries", "/media/images", "Images"),
    ("audio", "/api/audio-libraries", "/media/audio", "Audio"),
]


def call(method: str, path: str, body: dict | None = None, *, tolerate: tuple[int, ...] = ()):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if e.code in tolerate:
            return None
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def read_key() -> str:
    env = HERE / ".env"
    if not env.exists():
        sys.exit("docs/demo/.env missing (copy .env.example and add TMDB_API_KEY)")
    for line in env.read_text().splitlines():
        if line.startswith("TMDB_API_KEY="):
            key = line.split("=", 1)[1].strip().strip("\"'")
            if not re.fullmatch(r"[0-9a-f]{32}", key):
                sys.exit(f"TMDB_API_KEY must be the 32-char v3 key (got {len(key)} chars) — "
                         "not the long v4 read token")
            return key
    sys.exit("TMDB_API_KEY not found in docs/demo/.env")


def wait_healthy() -> None:
    for _ in range(60):
        try:
            urllib.request.urlopen(URL + "/api/health", timeout=3)
            return
        except Exception:
            time.sleep(2)
    sys.exit(f"{URL} never became healthy — is the demo container up?")


# Small hand-made subtitle files so the Subtitles shots show every state (real, generated,
# translated, .original backup). Written into library/ (never pristine/); skipped if present.
SUBTITLE_FIXTURES = [
    "Movies/Big Buck Bunny (2008).en.srt",
    "Movies/Big Buck Bunny (2008).ar.srt",
    "Movies/Tears of Steel (2012).en.srt",
    "Movies/Tears of Steel (2012).fr.generated.srt",
    "Movies/Sintel (2010).ar.translated.srt",
    "Movies/Sintel (2010).en.original.srt",
    "Movies/Elephants Dream (2006).en.srt",
]
SRT_BODY = (
    "1\n00:00:01,000 --> 00:00:04,000\nHello there.\n\n"
    "2\n00:00:05,000 --> 00:00:08,000\nThis is a demo subtitle.\n"
)


def seed_subtitle_files() -> None:
    root = HERE / "library" / "videos"
    if not root.exists():
        return
    for rel in SUBTITLE_FIXTURES:
        path = root / rel
        if path.parent.exists() and not path.exists():
            path.write_text(SRT_BODY, encoding="utf-8")
    print("subtitle fixtures written")


# Tiny generated videos (one still a second, a few KB per minute) in Identify's folder layout,
# for the Subtitles shots that search a whole show: they only need the right names and runtimes
# (a real episode is 20 to 50 minutes, so a subtitle's length fits). Each shows a frame cut from
# one of the demo's own open films, so thumbnails and the player are not blank boxes. Written
# into library/shows (never pristine/); skipped if present. Needs ffmpeg on the host.
# (folder, file name stem, episodes, seconds, source video under library/videos)
SHOW_FIXTURES = [
    # Only openly licensed titles (Creative Commons shows and films), never someone's catalogue.
    ("Pioneer One (2010)/Season 01", "Pioneer One (2010) - S01E{n:02d} - Episode {n}", 4, 2020,
     "Movies/Elephants Dream (2006).mkv"),
    ("Pioneer One (2010)/Season 02", "Pioneer One (2010) - S02E{n:02d} - Episode {n}", 3, 2020,
     "Movies/Elephants Dream (2006).mkv"),
    ("Sintel (2010)", "Sintel (2010)", 1, 888, "Movies/Sintel (2010).mkv"),
    ("Unsorted", "Some.Show.S01E{n:02d}.720p.WEB.x264-GRP", 3, 1500,
     "Movies/Big Buck Bunny (2008).mp4"),
]


def seed_show_fixtures() -> None:
    root = HERE / "library" / "shows"
    if not (HERE / "library").exists():
        return
    made = 0
    frames = Path(tempfile.mkdtemp(prefix="demo-frames-"))
    for folder, pattern, episodes, seconds, source in SHOW_FIXTURES:
        for n in range(1, episodes + 1):
            path = root / folder / f"{pattern.format(n=n)}.mkv"
            if path.exists():
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            # A different frame of the source for each episode.
            frame = frames / f"{abs(hash((source, n)))}.png"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-ss", str(8 + n * 7), "-i",
                 str(HERE / "library" / "videos" / source), "-frames:v", "1",
                 "-vf", "scale=480:-2", str(frame)],
                check=True,
            )
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "1", "-i", str(frame),
                 "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-shortest", "-t", str(seconds),
                 "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "120",
                 "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "8k", str(path)],
                check=True,
            )
            made += 1
    shutil.rmtree(frames, ignore_errors=True)
    # One real Arabic subtitle already on Season 2, so a Season 1 pick can be shown to leave it alone.
    old = root / "Pioneer One (2010)/Season 02/Pioneer One (2010) - S02E01 - Episode 1.ar.srt"
    if old.parent.exists() and not old.exists():
        old.write_text(SRT_BODY, encoding="utf-8")
    print(f"show fixtures: {made} video(s) written")


def main() -> None:
    seed_subtitle_files()
    seed_show_fixtures()
    key = read_key()
    wait_healthy()
    # nudenet 640m: the model copied into docs/demo/data/models (default is 320n).
    call("PATCH", "/api/settings", {"tmdb_api_key": key, "theme": "parallax", "nudenet_model": "640m"})
    print("settings: TMDB key set, theme=parallax, nudenet_model=640m")

    for kind, prefix, path, name in LIBRARIES:
        existing = call("GET", prefix) or []
        lib = next((x for x in existing if x["path"] == path), None)
        if lib is not None and not (lib.get("name") or "").strip():
            # Created by an earlier seed run without a name; there's no rename endpoint, so recreate.
            call("DELETE", f"{prefix}/{lib['id']}")
            print(f"{kind}: removed unnamed library {path}")
            lib = None
        if lib is None:
            created = call("POST", prefix, {"name": name, "path": path})
            lib = created[0] if isinstance(created, list) else created
            print(f"{kind}: created {path}")
        else:
            print(f"{kind}: exists {path}")
        # Image scan requires a JSON body (defaults = pHash + content detection); the others ignore it.
        # 409 = a scan is already running (e.g. creating the library queued one) — fine.
        call("POST", f"{prefix}/{lib['id']}/scan", {}, tolerate=(409,))
        print(f"{kind}: scan started (or already running)")

    call("PUT", "/api/organize/root", {"path": "/media"})
    print("organize: root=/media")
    print("done. Identify folder to pick in the UI: /media/identify-incoming")


if __name__ == "__main__":
    main()
