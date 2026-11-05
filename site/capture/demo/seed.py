#!/usr/bin/env python3
"""Seed the running demo instance (idempotent). Usage: python3 -P site/capture/demo/seed.py [--url URL]

Reads TMDB_API_KEY from docs/demo/.env (never printed), sets key + theme, creates the three
libraries if missing and starts a scan of each, and points Organize at the media root.
Stdlib only. Paths are as seen *inside* the container (library/ is mounted at /media).
"""

from __future__ import annotations

import json
import re
import sys
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


def main() -> None:
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
