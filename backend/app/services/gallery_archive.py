"""Inspect / reset gallery-dl's `--download-archive` (a SQLite file).

Pure filesystem + sqlite helpers, no DB session or HTTP. `ValueError` means the path is not a
gallery-dl archive; the router maps it.
"""

import os
import sqlite3

_SQLITE_MAGIC = b"SQLite format 3\x00"
# gallery-dl keeps SQLite sidecars next to the archive while a run holds it open.
_SIDECARS = ("-wal", "-shm", "-journal")


def _is_sqlite(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            return f.read(len(_SQLITE_MAGIC)) == _SQLITE_MAGIC
    except OSError:
        return False


def archive_info(path: str) -> dict:
    """`{path, exists, size, entries}`; `entries` is None when the file can't be counted."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return {"path": path, "exists": False, "size": 0, "entries": 0}
    entries: int | None = None
    if _is_sqlite(path):
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
            try:
                entries = con.execute("SELECT COUNT(*) FROM archive").fetchone()[0]
            finally:
                con.close()
        except sqlite3.Error:
            entries = None
    return {"path": path, "exists": True, "size": size, "entries": entries}


def reset_archive(path: str) -> bool:
    """Delete the archive (gallery-dl recreates it on the next run). False if there was none.

    The path is user-configurable, so refuse anything that isn't a SQLite file rather than
    delete whatever a typo'd custom path happens to point at.
    """
    if not os.path.isfile(path):
        return False
    if not _is_sqlite(path):
        raise ValueError("That path isn't a gallery-dl archive (not a SQLite file) — not deleting")
    os.remove(path)
    for suffix in _SIDECARS:
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass
    return True
