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
    if not os.path.isfile(video_path):
        raise SubtitleNotFound("That video file was not found.")
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


def _snapshot(entries: list[dict]) -> list[tuple[dict, str]]:
    """Each validated entry with its real path as it was when the listing was made. The walks
    that validate run OUTSIDE `_WRITE_LOCK` (they can take minutes on a big tree and would stall
    every job thread that saves a subtitle); under the lock `_revalidate` only re-checks these
    specific paths."""
    return [(e, _real(e["path"])) for e in entries]


def _revalidate(snap: list[tuple[dict, str]], refusal: str) -> None:
    """Under the lock: every snapshotted file still exists and still resolves to the same real
    path (a swapped-in symlink or a vanished file is refused), with no tree walk."""
    for entry, real in snap:
        path = entry["path"]
        if not os.path.lexists(path):
            raise SubtitleNotFound("That subtitle file was not found.")
        if _real(path) != real:
            raise SubtitleFileError(refusal)


_OWN_REFUSAL = "That is not a subtitle of this video."


def _owned(video_path: str, subtitle_paths: list[str]) -> list[dict]:
    """The listing entries for `subtitle_paths`, or SubtitleFileError if any is not one of the
    video's subtitle files."""
    _require_video(video_path)
    if not os.path.isfile(video_path):
        raise SubtitleNotFound("That video file was not found.")
    return _match(list_subtitle_files(video_path), subtitle_paths, _OWN_REFUSAL)


def _match(listed: list[dict], paths: list[str], refusal: str) -> list[dict]:
    """The listing entries for `paths` (by listed path first, then by real path), else a
    refusal. The listing is derived on the server, never from what the client sent."""
    by_path = {f["path"]: f for f in listed}
    by_real = {_real(f["path"]): f for f in listed}
    found = []
    for p in paths:
        if not isinstance(p, str) or "\0" in p:
            raise SubtitleFileError(refusal)
        entry = by_path.get(p) or by_real.get(_real(p))
        if entry is None:
            if not os.path.lexists(p):
                raise SubtitleNotFound("That subtitle file was not found.")
            raise SubtitleFileError(refusal)
        found.append(entry)
    return found


_UNMATCHED_REFUSAL = "That is not a subtitle found beside no video in this folder."


def _unmatched_owned(root: str, subtitle_paths: list[str]) -> list[dict]:
    """The entries of a fresh `unmatched_subtitles(root)` walk for `subtitle_paths`. A symlink is
    refused (it could lead outside the folder), as is anything a video claims."""
    if not isinstance(root, str) or not root or "\0" in root:
        raise SubtitleFileError("That is not a folder.")
    found = _match(unmatched_subtitles(root), subtitle_paths, _UNMATCHED_REFUSAL)
    if any(os.path.islink(e["path"]) for e in found):
        raise SubtitleFileError(_UNMATCHED_REFUSAL)
    return found


def rename_unmatched(root: str, subtitle_path: str, new_name: str) -> dict:
    """Rename a stray subtitle in its own folder; extension kept, nothing is overwritten."""
    snap = _snapshot(_unmatched_owned(root, [subtitle_path]))  # the walk, outside the lock
    with _WRITE_LOCK:
        _revalidate(snap, _UNMATCHED_REFUSAL)
        if os.path.islink(snap[0][0]["path"]):
            raise SubtitleFileError(_UNMATCHED_REFUSAL)
        old = snap[0][0]["path"]
        _check_new_name(old, new_name)
        new = os.path.join(os.path.dirname(old), new_name)
        if os.path.lexists(new):
            raise SubtitleFileError("A file with that name already exists.")
        try:
            os.replace(old, new)
        except OSError as e:
            raise SubtitleFileError(f"Could not rename the file: {e.strerror or e}") from e
    return {"path": new}


def delete_unmatched(root: str, subtitle_paths: list[str]) -> int:
    """Permanently delete exactly the validated stray subtitles; all-or-nothing on validation."""
    snap = _snapshot(_unmatched_owned(root, subtitle_paths))  # the walk, outside the lock
    with _WRITE_LOCK:
        _revalidate(snap, _UNMATCHED_REFUSAL)
        if any(os.path.islink(e["path"]) for e, _ in snap):
            raise SubtitleFileError(_UNMATCHED_REFUSAL)
        unique = {real: e for e, real in snap}
        return _remove(list(unique.values()))


def unmatched_entry(root: str, subtitle_path: str) -> dict:
    """One validated stray subtitle (for the temporary preview)."""
    (entry,) = _unmatched_owned(root, [subtitle_path])
    return entry


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
    snap = _snapshot(_owned(video_path, [subtitle_path]))  # the walk, outside the lock
    with _WRITE_LOCK:
        _revalidate(snap, _OWN_REFUSAL)
        old = snap[0][0]["path"]
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
    snap = _snapshot(_owned(video_path, [subtitle_path]))  # the walk, outside the lock
    with _WRITE_LOCK:
        _revalidate(snap, _OWN_REFUSAL)
        entry = snap[0][0]
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
    snap = _snapshot(_owned(video_path, subtitle_paths))  # the walk, outside the lock
    with _WRITE_LOCK:
        _revalidate(snap, _OWN_REFUSAL)
        unique = {real: e for e, real in snap}
        return _remove(list(unique.values()))


def _tidy_targets(files: list[dict], what: str) -> list[dict]:
    if what == "generated_translated":
        return [
            f for f in files if f["kind"] in (subtitle_names.GENERATED, subtitle_names.TRANSLATED)
        ]
    if what == "originals":
        return [f for f in files if f["kind"] == "original"]
    # An "extra" is a labelled real file with a plain file of the SAME language and the same
    # hearing-impaired flag beside it; a labelled .hi file with no plain .hi is not an extra.
    plain = {
        (f["language"], f["kind"] == "hearing_impaired")
        for f in files
        if f["kind"] in ("real", "hearing_impaired") and not f["label"]
    }
    return [
        f
        for f in files
        if f["kind"] in ("real", "hearing_impaired")
        and f["label"]
        and (f["language"], f["kind"] == "hearing_impaired") in plain
    ]


def tidy(video_paths: list[str], what: str) -> int:
    """Delete one family of files across several videos; returns how many went. Each video's
    folder is listed (one shared walk per distinct folder) before the write lock is taken; the
    lock only covers re-checking the chosen files and deleting them."""
    if what not in TIDY_MODES:
        raise SubtitleFileError("Unknown tidy-up choice.")
    total = 0
    dirs_cache: dict[str, list[str]] = {}
    for video in dict.fromkeys(video_paths):
        _require_video(video)
        if not os.path.isfile(video):
            raise SubtitleNotFound("That video file was not found.")
        targets = _tidy_targets(list_subtitle_files(video, dirs_cache), what)
        if not targets:
            continue
        snap = _snapshot(targets)
        with _WRITE_LOCK:
            try:
                _revalidate(snap, _OWN_REFUSAL)
            except SubtitleNotFound:
                continue  # one vanished since the listing: leave this video for the next tidy
            total += _remove(targets)
    return total


REMOVE_KINDS = ("real", "hearing_impaired", "generated", "translated", "original")


def count_by_kind(video_paths: list[str]) -> dict[str, dict[str, int]]:
    """How many subtitle files the videos have, `{language: {kind: count}}`, kinds as in
    `REMOVE_KINDS` (a kind with none is left out). The count behind Remove subtitles: a labelled
    real file counts as `real`, a `.hi` file as `hearing_impaired`, a sync backup as `original`.
    One shared walk per distinct folder; nothing is written."""
    counts: dict[str, dict[str, int]] = {}
    dirs_cache: dict[str, list[str]] = {}
    for video in dict.fromkeys(video_paths):
        for f in list_subtitle_files(video, dirs_cache):
            by_kind = counts.setdefault(f["language"], {})
            by_kind[f["kind"]] = by_kind.get(f["kind"], 0) + 1
    return counts


def remove_by_kind(video_paths: list[str], pairs: list[tuple[str, str]]) -> int:
    """Delete, across several videos, every subtitle file whose language and kind is in `pairs`
    (`("ar", "real")`: the plain and labelled real Arabic files, not the hearing-impaired,
    generated or translated ones, nor the sync backups). A hard delete, like Manage's Delete.
    Each video's folder is listed before the write lock is taken (one shared walk per distinct
    folder); the lock only covers re-checking the chosen files and deleting them. A file that
    vanished since the listing leaves that video for the next time. Returns how many went."""
    wanted = set(pairs)
    total = 0
    dirs_cache: dict[str, list[str]] = {}
    for video in dict.fromkeys(video_paths):
        targets = [
            f
            for f in list_subtitle_files(video, dirs_cache)
            if (f["language"], f["kind"]) in wanted
        ]
        if not targets:
            continue
        snap = _snapshot(targets)
        with _WRITE_LOCK:
            try:
                _revalidate(snap, _OWN_REFUSAL)
            except SubtitleNotFound:
                continue
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
