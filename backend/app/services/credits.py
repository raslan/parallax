"""Credits: the single list of everything Parallax uses, ships or adapts.

The data lives in `app/assets/credits.json`. It is the one place to maintain credits: the app's
Settings → Credits tab reads it through `GET /api/credits`, and the public docs site builds its
Acknowledgements page from the same file (`site/scripts/sync-credits.mjs`). Each entry says where
it is shown with `show.app` / `show.site`, so, for example, the download tools can appear in the
app but not on the site.
"""

import json
from pathlib import Path
from typing import Literal

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"

# How Parallax relates to the thing, in the order the UI explains them.
HOW_VALUES = ("shipped", "installed", "downloaded", "adapted", "service", "media", "site")

Scope = Literal["app", "site"]


def load_credits() -> dict:
    """The whole file, unfiltered."""
    return json.loads((ASSETS_DIR / "credits.json").read_text(encoding="utf-8"))


def credits_for(scope: Scope) -> dict:
    """Groups and entries visible in `scope`, in file order, with empty groups dropped."""
    data = load_credits()
    entries = [e for e in data["entries"] if e["show"].get(scope)]
    used = {e["group"] for e in entries}
    groups = [g for g in data["groups"] if g["id"] in used]
    return {"groups": groups, "entries": entries}
