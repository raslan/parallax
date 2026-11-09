"""Shared `_originals/` backup mechanism, parametrised over media kind.

`api/originals.py` (video) and `api/audio_originals.py` (audio) are thin route
wrappers around these functions. All of this is pure `_originals/`-directory
path logic — walk for `_originals` dirs, match the same-stem current file,
restore via `shutil.move`, reset + re-probe the DB row. None of it is
codec-aware; the only per-kind variation is which SQLAlchemy models and which
rescan function to use, carried by `OriginalsKind`.
"""

import os
import shutil
from collections.abc import Callable, Collection
from dataclasses import dataclass

from fastapi import HTTPException

from app.models.file import FileStatus
from app.services import stats


@dataclass(frozen=True)
class OriginalsKind:
    library_model: type  # Library | AudioLibrary
    file_model: type  # File | AudioFile
    rescan_fn: Callable  # scanner.rescan_file | audio_scanner.rescan_audio_file
    route_prefix: str  # "/originals" | "/audio-originals"
    reset_at_field: str = "transcoded_at"  # File.transcoded_at | AudioFile.compressed_at
    media: str = "video"  # stats media bucket: video | audio
    # The kind's media extensions (with dot). The same-stem fallback below only considers files
    # of this kind, so a `movie.srt` / `movie.nfo` next to a vanished video is not "the current
    # file". None = any extension.
    extensions: Collection[str] | None = None
    # How the `extension` column is stored: video rows have none ("mkv"), audio rows keep it
    # (".mp3"). A restore must write the kind's own form or `/files` sorts the two apart.
    dotted_extension: bool = False


def move_to_originals(path: str, filename: str, file_id: int) -> str:
    """Move `path` into a sibling `_originals/` folder and return where it went.

    Never overwrites: if `_originals/<filename>` is taken (an earlier removal of a same-named
    file) the backup becomes `<stem>_<file_id>.<ext>`, then `<stem>_<file_id>_<n>.<ext>`.
    `shutil.move` onto an existing file replaces it, and that older backup may be the only copy.
    """
    originals_dir = os.path.join(os.path.dirname(path), "_originals")
    os.makedirs(originals_dir, exist_ok=True)
    dest = os.path.join(originals_dir, filename)
    if os.path.exists(dest):
        base, ext = os.path.splitext(filename)
        dest = os.path.join(originals_dir, f"{base}_{file_id}{ext}")
        n = 1
        while os.path.exists(dest):
            dest = os.path.join(originals_dir, f"{base}_{file_id}_{n}{ext}")
            n += 1
    shutil.move(path, dest)
    return dest


def _backup_path(path: str) -> str:
    """The normalised path of one backup, which must be a file directly inside an `_originals`
    folder. Normalised *before* the check: `.../_originals/../movie.mp4` contains the text
    '/_originals/' but is the live movie, and a substring test let a delete or restore through."""
    clean = os.path.normpath(path)
    if os.path.basename(os.path.dirname(clean)) != "_originals":
        raise HTTPException(400, "Path is not inside an _originals directory")
    return clean


def scan_library_originals(kind: OriginalsKind, library, db) -> list[dict]:
    entries: list[dict] = []
    base = library.path.rstrip("/")
    if not os.path.isdir(base):
        return entries

    for root, _dirs, files in os.walk(base):
        if os.path.basename(root) != "_originals":
            continue
        parent_dir = os.path.dirname(root)
        for filename in sorted(files):
            original_path = os.path.join(root, filename)
            try:
                original_size = os.path.getsize(original_path)
            except OSError:
                continue

            current_path = os.path.join(parent_dir, filename)
            # Transcode may have changed the extension (e.g. .webm → .mkv) —
            # fall back to any same-stem file in the parent dir
            if not os.path.exists(current_path):
                stem = os.path.splitext(filename)[0]
                try:
                    for candidate in sorted(os.listdir(parent_dir)):
                        c_stem, c_ext = os.path.splitext(candidate)
                        if kind.extensions is not None and c_ext.lower() not in kind.extensions:
                            continue
                        if c_stem == stem and candidate != filename:
                            full = os.path.join(parent_dir, candidate)
                            if os.path.isfile(full):
                                current_path = full
                                break
                except OSError:
                    pass
            current_size: int | None = None
            if os.path.exists(current_path):
                try:
                    current_size = os.path.getsize(current_path)
                except OSError:
                    pass

            savings = (original_size - current_size) if current_size is not None else None

            entries.append(
                {
                    "path": original_path,
                    "filename": filename,
                    "library_id": library.id,
                    "library_name": library.name,
                    "original_size": original_size,
                    "current_path": current_path if os.path.exists(current_path) else None,
                    "current_size": current_size,
                    "savings_bytes": savings,
                }
            )

    return entries


def build_summary(entries: list[dict]) -> dict:
    total_orig = sum(e["original_size"] for e in entries)
    total_current = sum(e["current_size"] for e in entries if e["current_size"] is not None)
    total_savings = sum(e["savings_bytes"] for e in entries if e["savings_bytes"] is not None)
    return {
        "entries": entries,
        "total_original_bytes": total_orig,
        "total_current_bytes": total_current,
        "total_savings_bytes": total_savings,
    }


def delete_original(db, path: str) -> None:
    """Delete one `_originals/` backup file. Kind-agnostic — pure path op."""
    path = _backup_path(path)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    os.remove(path)
    # Clean up empty _originals dir
    originals_dir = os.path.dirname(path)
    try:
        if not os.listdir(originals_dir):
            os.rmdir(originals_dir)
    except OSError:
        pass


def restore_one(kind: OriginalsKind, db, path: str) -> str:
    """Restore one file from _originals/. Returns the restored path.

    Raises HTTPException on validation failure (bad path, missing file) —
    callers that loop over many paths should catch HTTPException per item
    rather than let one bad path abort the whole batch.
    """
    path = _backup_path(path)
    if not os.path.isfile(path):
        raise HTTPException(404, "Original file not found")

    originals_dir = os.path.dirname(path)
    parent_dir = os.path.dirname(originals_dir)
    filename = os.path.basename(path)
    restore_path = os.path.join(parent_dir, filename)

    file_model = kind.file_model

    # Find the DB record — extension may differ if transcode changed the container
    # (e.g. .webm original transcoded to .mkv)
    file_obj = db.query(file_model).filter(file_model.path == restore_path).first()
    if not file_obj:
        stem = os.path.splitext(filename)[0]
        # A literal prefix match, then an exact stem-and-folder check in Python: a SQL LIKE
        # treats `_` and `%` in names as wildcards, so `my_movie.*` also matched `my movie.mp4`
        # and the restore then deleted that unrelated file. `movie.part2.mkv` must not match
        # `movie` either.
        prefix = os.path.join(parent_dir, stem) + "."
        candidates = (
            db.query(file_model)
            .filter(file_model.path.startswith(prefix, autoescape=True))
            .order_by(file_model.id)
            .all()
        )
        file_obj = next(
            (
                c
                for c in candidates
                if os.path.dirname(c.path) == parent_dir
                and os.path.splitext(os.path.basename(c.path))[0] == stem
            ),
            None,
        )

    # Delete the transcoded file (use DB path so we get the right extension)
    transcoded_path = file_obj.path if file_obj else restore_path
    original_size = os.path.getsize(path)
    current_size = os.path.getsize(transcoded_path) if os.path.exists(transcoded_path) else None
    if os.path.exists(transcoded_path) and transcoded_path != restore_path:
        os.remove(transcoded_path)
    elif os.path.exists(restore_path):
        os.remove(restore_path)

    shutil.move(path, restore_path)

    # Clean up empty _originals dir
    try:
        if not os.listdir(originals_dir):
            os.rmdir(originals_dir)
    except OSError:
        pass

    # Reset the DB record so the file shows as needing repair again, then
    # re-probe it immediately — the restored file is real content the user is
    # about to look at, it shouldn't sit on stale pre-restore metadata until
    # the filesystem watcher's 30s debounce gets around to it.
    if file_obj:
        file_obj.status = FileStatus.UNKNOWN
        setattr(file_obj, kind.reset_at_field, None)
        file_obj.path = restore_path
        file_obj.filename = filename
        ext = os.path.splitext(filename)[1].lower()
        file_obj.extension = ext if kind.dotted_extension else ext.lstrip(".")
        db.commit()
        kind.rescan_fn(db, file_obj)

    # After the commit: the stat has its own session and must not contend for the lock.
    stats.record_restore(kind.media, original_size, current_size)
    return restore_path


def delete_library_originals(kind: OriginalsKind, db, library_id: int) -> None:
    lib = db.get(kind.library_model, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    entries = scan_library_originals(kind, lib, db)
    for entry in entries:
        try:
            os.remove(entry["path"])
        except OSError:
            pass
        originals_dir = os.path.dirname(entry["path"])
        try:
            if not os.listdir(originals_dir):
                os.rmdir(originals_dir)
        except OSError:
            pass
