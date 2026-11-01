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


def ytdlp_archive_path(path: str) -> str:
    """yt-dlp's own `--download-archive` (plain text) that rides beside gallery-dl's archive.

    gallery-dl's ytdl backend resolves every playlist entry (a full YouTube request) *before*
    its archive is consulted; yt-dlp checks its archive from the id in the URL, before any
    request. So the ytdl rung hands yt-dlp this file too.
    """
    return path + ".yt-dlp.txt"


# gallery-dl archive rows for the ytdl backend are `<category><extractor_key> <id>`, e.g.
# `ytdlYoutube dQw4w9WgXcQ`; yt-dlp writes `<extractor_key lowercased> <id>`.
_GDL_YT_PREFIX = "ytdlYoutube "


def seed_ytdlp_archive(gdl_path: str, ytdlp_path: str) -> int:
    """Append every YouTube id in gallery-dl's archive that yt-dlp's archive lacks.

    Idempotent and cheap (run before each ytdl attempt). Returns the number of lines added;
    0 when gallery-dl has no archive or it can't be read.
    """
    if not _is_sqlite(gdl_path):
        return 0
    try:
        con = sqlite3.connect(f"file:{gdl_path}?mode=ro", uri=True, timeout=5)
        try:
            rows = con.execute(
                "SELECT entry FROM archive WHERE entry LIKE ? ESCAPE '\\'",
                (_GDL_YT_PREFIX + "%",),
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return 0
    wanted = ["youtube " + r[0][len(_GDL_YT_PREFIX) :] for r in rows]
    try:
        with open(ytdlp_path, encoding="utf-8") as f:
            have = {line.strip() for line in f}
    except OSError:
        have = set()
    missing = [w for w in wanted if w not in have]
    if missing:
        with open(ytdlp_path, "a", encoding="utf-8") as f:
            f.write("\n".join(missing) + "\n")
    return len(missing)


def reset_archive(path: str) -> bool:
    """Delete the archive (gallery-dl recreates it on the next run). False if there was none.

    The path is user-configurable, so refuse anything that isn't a SQLite file rather than
    delete whatever a typo'd custom path happens to point at. The yt-dlp companion file goes
    too — left behind it would keep skipping videos the user just asked to re-fetch.
    """
    removed = False
    if os.path.isfile(path):
        if not _is_sqlite(path):
            raise ValueError(
                "That path isn't a gallery-dl archive (not a SQLite file) — not deleting"
            )
        os.remove(path)
        removed = True
    for companion in (ytdlp_archive_path(path), *(path + s for s in _SIDECARS)):
        try:
            os.remove(companion)
        except FileNotFoundError:
            continue
        removed = removed or companion == ytdlp_archive_path(path)
    return removed
