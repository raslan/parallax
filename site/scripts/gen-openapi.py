#!/usr/bin/env python3
"""Dump the backend's OpenAPI schema for the public API reference.

    cd site && npm run gen-openapi

Runs `app.openapi()` in-process (no server) with a throwaway DATA_DIR, then:

- sets the version from the repo's version.txt,
- drops the SPA catch-all route.

The download tools may be named here: the API reference pages are kept out of crawlers by
`site/app/robots.ts`, and the owner is fine with it.

The result is committed at site/openapi/parallax.json, so building the site needs neither Python
nor the backend's dependencies.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "openapi" / "parallax.json"

HIDDEN_PATHS = {"/{full_path}"}  # the frontend's catch-all route


def load_schema() -> dict:
    os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="parallax-openapi-")
    sys.path.insert(0, str(ROOT / "backend"))
    from app.main import app  # noqa: PLC0415 - needs DATA_DIR set first

    return app.openapi()


def main() -> None:
    schema = load_schema()
    schema["info"]["version"] = (ROOT / "version.txt").read_text().strip()
    # Examples in the reference show where a self-hoster's server usually is.
    schema["servers"] = [{"url": "http://localhost:7899", "description": "Your Parallax server"}]

    for path in list(schema["paths"]):
        if path in HIDDEN_PATHS:
            del schema["paths"][path]

    text = json.dumps(schema, indent=1, sort_keys=False) + "\n"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    ops = sum(1 for item in schema["paths"].values() for k in item if k in ("get", "post", "put", "patch", "delete"))
    print(f"gen-openapi: wrote {OUT.relative_to(ROOT)} ({len(schema['paths'])} paths, {ops} operations)")


if __name__ == "__main__":
    main()
