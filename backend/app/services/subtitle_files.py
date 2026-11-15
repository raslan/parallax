"""Manage the subtitle files that sit beside a video: list, rename, make main, delete, tidy.

Every function that touches a file first checks that the file is one of the video's own
subtitles (`list_subtitle_files`, compared by resolved real path), so a client can never make
these routines act on `../../etc/passwd`, a video, or another video's subtitle. All writes
happen under one module lock, so two racing requests cannot interleave a swap or a rename.
"""

import os
import re
import threading
import uuid

from app.services import subtitle_names
from app.services.subtitle_service import (
    SUBTITLE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    _subtitle_search_dirs,
    _tagged_files,
)

TIDY_MODES = ("generated_translated", "extra_versions", "originals")

# One lock for every write (rename, swap, delete): these are rare, user-triggered and quick,
# so a single lock is simpler than one per video and still rules out interleaving.
_WRITE_LOCK = threading.RLock()


class SubtitleFileError(Exception):
    """A refusal whose message is for the user. The HTTP status lives in api/subtitle_files.py."""


class SubtitleNotFound(SubtitleFileError):
    """The video or subtitle file does not exist."""


def _real(path: str) -> str:
    return os.path.realpath(path)


def _require_video(video_path: str) -> None:
    """Refuse anything that is not a video file name: the search walks the video's whole
    folder, so `/x.txt` must never start a walk of `/`."""
    if (
        not isinstance(video_path, str)
        or not video_path
        or "\0" in video_path
        or os.path.splitext(video_path)[1].lower() not in VIDEO_EXTENSIONS
    ):
        raise SubtitleFileError("That is not a video file.")


def list_subtitle_files(
    video_path: str, dirs_cache: dict[str, list[str]] | None = None
) -> list[dict]:
    """Every subtitle file of the video (the scan's own search dirs, exact `stem + "."`
    match), including `original` backups. `dirs_cache` (folder -> search dirs) lets a caller
    listing many videos walk each distinct folder once."""
    _require_video(video_path)
    video_dir = os.path.dirname(video_path)
    search_dirs = None
    if dirs_cache is not None:
        if video_dir not in dirs_cache:
            dirs_cache[video_dir] = _subtitle_search_dirs(video_path)
        search_dirs = dirs_cache[video_dir]
    out = []
    for path, tag in _tagged_files(video_path, search_dirs):
        try:
            size = os.stat(path).st_size
        except OSError:
            continue
        rel = os.path.relpath(os.path.dirname(path), video_dir)
        out.append(
            {
                "path": path,
                "name": os.path.basename(path),
                "language": tag.lang,
                "label": tag.label,
                "kind": tag.kind,
                "size": size,
                "directory": "" if rel == "." else rel,
            }
        )
    out.sort(key=lambda f: (f["directory"], f["name"]))
    return out


def _owned(video_path: str, subtitle_paths: list[str]) -> list[dict]:
    """The listing entries for `subtitle_paths`, or SubtitleFileError if any is not one of the
    video's subtitle files."""
    _require_video(video_path)
    if not os.path.isfile(video_path):
        raise SubtitleNotFound("That video file was not found.")
    listed = list_subtitle_files(video_path)
    by_path = {f["path"]: f for f in listed}
    by_real = {_real(f["path"]): f for f in listed}
    found = []
    for p in subtitle_paths:
        if not isinstance(p, str) or "\0" in p:
            raise SubtitleFileError("That is not a subtitle of this video.")
        entry = by_path.get(p) or by_real.get(_real(p))
        if entry is None:
            if not os.path.lexists(p):
                raise SubtitleNotFound("That subtitle file was not found.")
            raise SubtitleFileError("That is not a subtitle of this video.")
        found.append(entry)
    return found


def _check_new_name(old_path: str, new_name: str) -> None:
    if not new_name or new_name != new_name.strip():
        raise SubtitleFileError("Type a name for the file.")
    if "/" in new_name or "\\" in new_name or "\0" in new_name:
        raise SubtitleFileError("A file name cannot contain / or \\.")
    if new_name.startswith("."):
        raise SubtitleFileError("A file name cannot start with a dot.")
    if os.path.splitext(new_name)[1].lower() != os.path.splitext(old_path)[1].lower():
        raise SubtitleFileError("Keep the file extension the same.")
    if len(new_name.encode()) > 255:
        raise SubtitleFileError("That name is too long.")


def rename_subtitle(video_path: str, subtitle_path: str, new_name: str) -> dict:
    """Rename in the same folder, extension kept; never overwrites."""
    with _WRITE_LOCK:
        (entry,) = _owned(video_path, [subtitle_path])
        old = entry["path"]
        _check_new_name(old, new_name)
        new = os.path.join(os.path.dirname(old), new_name)
        if os.path.lexists(new):
            raise SubtitleFileError("A file with that name already exists.")
        try:
            os.replace(old, new)
        except OSError as e:
            raise SubtitleFileError(f"Could not rename the file: {e.strerror or e}") from e
    stem = os.path.splitext(os.path.basename(video_path))[0]
    return {"path": new, "outside_view": not new_name.startswith(stem + ".")}


def make_main(video_path: str, subtitle_path: str) -> dict:
    """Swap a labelled real subtitle's name with the plain `<stem>.<lang>.<ext>`, so the
    player's default changes. All-or-nothing: a failed step is rolled back."""
    with _WRITE_LOCK:
        (entry,) = _owned(video_path, [subtitle_path])
        if entry["kind"] not in ("real", "hearing_impaired") or not entry["label"]:
            raise SubtitleFileError("Only a labelled subtitle can be made the main one.")
        sub = entry["path"]
        ext = os.path.splitext(sub)[1]
        main = subtitle_names.subtitle_path(
            video_path,
            entry["language"],
            hearing_impaired=entry["kind"] == "hearing_impaired",
            ext=ext,
        )
        try:
            if not os.path.lexists(main):
                os.replace(sub, main)
                return {"main": main, "other": None}
            tmp = f"{main}.swap-{uuid.uuid4().hex[:8]}"
            os.replace(main, tmp)
            try:
                os.replace(sub, main)
            except OSError:
                os.replace(tmp, main)
                raise
            try:
                os.replace(tmp, sub)
            except OSError:
                os.replace(main, sub)
                os.replace(tmp, main)
                raise
        except OSError as e:
            raise SubtitleFileError(
                f"Could not swap the files, nothing was changed: {e.strerror or e}"
            ) from e
        return {"main": main, "other": sub}


def _remove(entries: list[dict]) -> int:
    n = 0
    for e in entries:
        try:
            os.remove(e["path"])
            n += 1
        except FileNotFoundError:
            continue
        except OSError as err:
            raise SubtitleFileError(f"Could not delete {e['name']}: {err.strerror or err}") from err
    return n


def delete_subtitles(video_path: str, subtitle_paths: list[str]) -> int:
    with _WRITE_LOCK:
        entries = _owned(video_path, subtitle_paths)
        unique = {_real(e["path"]): e for e in entries}
        return _remove(list(unique.values()))


def _tidy_targets(files: list[dict], what: str) -> list[dict]:
    if what == "generated_translated":
        return [
            f for f in files if f["kind"] in (subtitle_names.GENERATED, subtitle_names.TRANSLATED)
        ]
    if what == "originals":
        return [f for f in files if f["kind"] == "original"]
    plain = {f["language"] for f in files if f["kind"] == "real" and not f["label"]}
    return [
        f
        for f in files
        if f["kind"] in ("real", "hearing_impaired") and f["label"] and f["language"] in plain
    ]


def tidy(video_paths: list[str], what: str) -> int:
    """Delete one family of files across several videos; returns how many went."""
    if what not in TIDY_MODES:
        raise SubtitleFileError("Unknown tidy-up choice.")
    total = 0
    with _WRITE_LOCK:
        for video in dict.fromkeys(video_paths):
            _require_video(video)
            if not os.path.isfile(video):
                raise SubtitleNotFound("That video file was not found.")
            targets = _tidy_targets(list_subtitle_files(video), what)
            if targets:
                _owned(video, [t["path"] for t in targets])
                total += _remove(targets)
    return total


_SPLIT = re.compile(r"[\s._\-]+")


def _language_of(name: str) -> str | None:
    """Language from a stray subtitle's name: a full language name anywhere (`2_English`,
    `Movie.Arabic`), or a 2/3-letter code only as the last word (`Movie.en`), since short
    words such as `it`, `no` or `hi` are common in titles."""
    from babelfish import Language

    tokens = [t for t in _SPLIT.split(os.path.splitext(name)[0]) if t]
    for tok in tokens:
        if len(tok) >= 4 and tok.isalpha():
            try:
                lang = Language.fromname(tok)
            except Exception:
                continue
            return str(lang.alpha2 or lang.alpha3)
    if tokens and tokens[-1].isalpha() and tokens[-1].lower() != subtitle_names.HI:
        tok = tokens[-1].lower()
        try:
            if len(tok) == 2:
                lang = Language.fromalpha2(tok)
            elif len(tok) == 3:
                lang = Language(tok)
            else:
                return None
        except Exception:
            return None
        return str(lang.alpha2 or lang.alpha3)
    return None


def unmatched_subtitles(root: str) -> list[dict]:
    """Subtitle files under `root` that no video of `root` claims by the exact-stem rule (a
    video claims `stem + "."` files in its own folder and below). One walk of the tree."""
    if not os.path.isdir(root):
        raise SubtitleNotFound("That folder was not found.")
    stems: dict[str, list[str]] = {}
    subs: list[tuple[str, str]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in filenames:
            base, ext = os.path.splitext(name)
            ext = ext.lower()
            if ext in VIDEO_EXTENSIONS:
                stems.setdefault(os.path.normpath(dirpath), []).append(base + ".")
            elif ext in SUBTITLE_EXTENSIONS:
                subs.append((dirpath, name))
    root_n = os.path.normpath(root)
    out = []
    for dirpath, name in subs:
        base = os.path.splitext(name)[0]
        d = os.path.normpath(dirpath)
        claimed = False
        while True:
            if any(base.startswith(p) for p in stems.get(d, ())):
                claimed = True
                break
            if d == root_n or d == os.path.dirname(d):
                break
            d = os.path.dirname(d)
        if claimed:
            continue
        rel = os.path.relpath(dirpath, root)
        out.append(
            {
                "path": os.path.join(dirpath, name),
                "name": name,
                "directory": "" if rel == "." else rel,
                "language": _language_of(name),
            }
        )
    out.sort(key=lambda f: (f["directory"], f["name"]))
    return out
