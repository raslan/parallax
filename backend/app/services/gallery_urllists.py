"""Named URL lists for Galleries' file mode — plain `<name>.txt` files in `LISTS_DIR`.

One URL per line; blank lines and `#` comments are skipped (as `gallery-dl -i`). File mode
expands the selected list at enqueue time (see `api/galleries.py`), so a list is only ever
read, never handed to gallery-dl itself.

Pure filesystem helpers with no DB or HTTP; the router maps the exceptions:
`ValueError` (bad name), `FileNotFoundError`, `FileExistsError`.
"""

import os
import re
import shutil

from app.config import GALLERY_DL_DIR

LISTS_DIR = os.path.join(GALLERY_DL_DIR, "lists")
# The single global file that predates named lists. Kept on disk (not moved) because
# history rows retried in the legacy `-i urls.txt` form still point at it.
LEGACY_FILE = os.path.join(GALLERY_DL_DIR, "urls.txt")
DEFAULT_LIST = "default"

# A filename stem: starts with a letter/digit/underscore, no separators or leading dot.
_NAME_RE = re.compile(r"^[\w][\w .\-]{0,63}$")


def validate_name(name: str) -> str:
    """The trimmed name, or ValueError — it becomes a filename, so no path tricks get through."""
    cleaned = name.strip()
    if not _NAME_RE.match(cleaned) or cleaned.endswith("."):
        raise ValueError(
            "List names are 1-64 characters: letters, numbers, spaces, '.', '-' and '_'"
        )
    return cleaned


def _path(name: str) -> str:
    return os.path.join(LISTS_DIR, validate_name(name) + ".txt")


def list_exists(name: str) -> bool:
    """True when `name` is a valid name and its file exists (ValueError on a bad name)."""
    _migrate_legacy()
    return os.path.isfile(_path(name))


def parse_urls(text: str) -> list[str]:
    lines = [ln.strip() for ln in text.splitlines()]
    return [ln for ln in lines if ln and not ln.startswith("#")]


def _migrate_legacy() -> None:
    """First run after upgrade: seed `default` from the old global urls.txt (copy, not move)."""
    # The lists dir existing *is* the "already migrated" marker. Keying off "no .txt files"
    # instead would re-seed the old file after the user deletes every list.
    if os.path.isdir(LISTS_DIR) or not os.path.isfile(LEGACY_FILE):
        return
    os.makedirs(LISTS_DIR, exist_ok=True)
    shutil.copyfile(LEGACY_FILE, os.path.join(LISTS_DIR, DEFAULT_LIST + ".txt"))


def list_lists() -> list[dict]:
    """`[{name, count}]` sorted by name, count = number of URLs in the list."""
    _migrate_legacy()
    try:
        files = [f for f in os.listdir(LISTS_DIR) if f.endswith(".txt")]
    except FileNotFoundError:
        return []
    out = []
    for f in files:
        name = f[: -len(".txt")]
        try:
            with open(os.path.join(LISTS_DIR, f), encoding="utf-8") as fh:
                count = len(parse_urls(fh.read()))
        except OSError:
            continue
        out.append({"name": name, "count": count})
    return sorted(out, key=lambda x: x["name"].lower())


def read_list(name: str) -> str:
    _migrate_legacy()
    with open(_path(name), encoding="utf-8") as f:
        return f.read()


def read_urls(name: str) -> list[str]:
    return parse_urls(read_list(name))


def write_list(name: str, text: str) -> None:
    """Create or overwrite, atomically (a crash mid-save never leaves a half-written list)."""
    path = _path(name)
    _migrate_legacy()  # before the dir exists, or creating a list first would skip the seed
    os.makedirs(LISTS_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def delete_list(name: str) -> None:
    os.remove(_path(name))


def rename_list(old: str, new: str) -> str:
    """Rename and return the validated new name. FileExistsError rather than overwrite."""
    src, dst = _path(old), _path(new)
    if not os.path.isfile(src):
        raise FileNotFoundError(old)
    if os.path.exists(dst) and os.path.normcase(src) != os.path.normcase(dst):
        raise FileExistsError(new)
    os.replace(src, dst)
    return validate_name(new)
