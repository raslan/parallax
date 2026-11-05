#!/usr/bin/env python3
"""Dump the backend's OpenAPI schema for the public API reference.

    cd site && npm run gen-openapi

Runs `app.openapi()` in-process (no server) with a throwaway DATA_DIR, then:

- sets the version from the repo's version.txt,
- drops routes that exist only to manage the download tools and the SPA catch-all,
- drops schema properties named after those tools,
- fails if any forbidden term is still anywhere in the result (the site never names the tools).

The result is committed at site/openapi/parallax.json, so building the site needs neither Python
nor the backend's dependencies.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "openapi" / "parallax.json"

# Anything matching this must not appear in the published schema.
FORBIDDEN = re.compile(r"yt[-_]?dlp|ytdl|youtube[-_]?dl|gallery[-_]?dl|gallerydl", re.IGNORECASE)

# Operations whose path names the tools are management endpoints for them; leave them out.
HIDDEN_PATH = re.compile(r"ytdl|dlp|gallery[-_]?dl", re.IGNORECASE)
HIDDEN_PATHS = {"/{full_path}"}  # the frontend's catch-all route


def load_schema() -> dict:
    os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="parallax-openapi-")
    sys.path.insert(0, str(ROOT / "backend"))
    from app.main import app  # noqa: PLC0415 - needs DATA_DIR set first

    return app.openapi()


def strip_hidden_properties(node: object) -> None:
    """Remove any object property whose name matches FORBIDDEN, from `properties` and `required`."""
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            for name in [n for n in props if FORBIDDEN.search(n)]:
                del props[name]
                if isinstance(node.get("required"), list) and name in node["required"]:
                    node["required"].remove(name)
        for value in node.values():
            strip_hidden_properties(value)
    elif isinstance(node, list):
        for value in node:
            strip_hidden_properties(value)


def main() -> None:
    schema = load_schema()
    schema["info"]["version"] = (ROOT / "version.txt").read_text().strip()
    # Examples in the reference show where a self-hoster's server usually is.
    schema["servers"] = [{"url": "http://localhost:7899", "description": "Your Parallax server"}]

    for path in list(schema["paths"]):
        if path in HIDDEN_PATHS or HIDDEN_PATH.search(path):
            del schema["paths"][path]

    strip_hidden_properties(schema.get("components", {}))

    text = json.dumps(schema, indent=1, sort_keys=False) + "\n"
    hits = sorted({m.group(0) for m in FORBIDDEN.finditer(text)})
    if hits:
        # Show enough context to fix it at the source (docstring, summary or field description).
        for m in FORBIDDEN.finditer(text):
            start = max(0, m.start() - 60)
            print(f"forbidden term {m.group(0)!r}: ...{text[start : m.end() + 60]!r}", file=sys.stderr)
        sys.exit(f"forbidden terms in the OpenAPI schema: {hits}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    ops = sum(1 for item in schema["paths"].values() for k in item if k in ("get", "post", "put", "patch", "delete"))
    print(f"gen-openapi: wrote {OUT.relative_to(ROOT)} ({len(schema['paths'])} paths, {ops} operations)")


if __name__ == "__main__":
    main()
