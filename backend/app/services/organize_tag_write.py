"""Apply tag edits to one file for Organize: plan, write, verify, replace.

``apply_one`` is the only function the route calls. A rewrite never touches the user's
file until the result has been re-read and checked: the edit goes to a hidden temp copy in
the same folder (scans and the watcher skip hidden files), is verified, and only then
replaces the original, with its modification time and mode put back. mkv/webm are edited
in place by ``mkvpropedit`` and are rolled back from an in-memory snapshot if the check
fails. Tag text never goes to logs.

Callers must have sandboxed ``path`` already. Blocking: call via a threadpool.
"""

import contextlib
import logging
import os
import shutil
import stat
import subprocess
import threading
from dataclasses import dataclass
from typing import Literal

from app.services import organize_tag_writers as writers
from app.services import organize_tags
from app.services.organize_tag_plan import (
    RAW_PREFIX,
    WritePlan,
    family_of,
    label_of,
    plan_one,
    validate_raw_name,
)

logger = logging.getLogger(__name__)

_FREE_SPACE_MARGIN = 1024 * 1024
_DURATION_TOLERANCE_S = 0.1
_DURATION_TOLERANCE_RATIO = 0.005
_ALLOWED_CONTROL = frozenset("\n\r\t")


@dataclass(frozen=True)
class ApplyResult:
    status: Literal["written", "failed"]
    message: str = ""


def _failed(message: str) -> ApplyResult:
    return ApplyResult("failed", message)


# One edit per file at a time: two requests naming the same path queue instead of racing.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(path: str) -> threading.Lock:
    key = os.path.realpath(path)
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _clean(changes: dict[str, str | None]) -> dict[str, str | None]:
    """A blank value is a clear; a value with control characters (a NUL splits an ID3 text
    frame into several values, and most tag formats cannot hold them) is refused."""
    cleaned: dict[str, str | None] = {}
    for key, value in changes.items():
        if value is not None:
            if any((ord(c) < 32 and c not in _ALLOWED_CONTROL) or ord(c) == 127 for c in value):
                raise writers.WriteError(
                    f"{label_of(key.removeprefix(RAW_PREFIX))} contains characters that "
                    "tags can't store."
                )
            if not value.strip():
                value = None
        cleaned[key] = value
    return cleaned


def _check_fields(path: str, plan: WritePlan, changes: dict[str, str | None]) -> None:
    for key in changes:
        if key in plan.fields:
            continue
        if key.startswith(RAW_PREFIX):
            if not plan.can_add_raw:
                raise writers.WriteError(
                    "This format has fixed fields only: other tag names can't be added."
                )
            message = validate_raw_name(path, key[len(RAW_PREFIX) :])
            if message:
                raise writers.WriteError(message)
        else:
            raise writers.WriteError(f"{label_of(key)} can't be stored in this file.")


def _read_for_verify(path: str, family: str) -> dict | None:
    """The file's tags, full and uncapped. Unlike ``read_tags`` it also reads the hidden
    temp copy a rewrite is checked on."""
    if family == "image":
        return organize_tags._read_images([path], True)[path]
    return organize_tags._read_media(path, True)


def _duration(path: str) -> float | None:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]
    try:
        done = subprocess.run(
            [*cmd, "--", os.path.abspath(path)],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        return float(done.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _track(text: str) -> object:
    head, _, tail = text.partition("/")
    try:
        return (int(head), int(tail) if tail.strip() else 0)
    except ValueError:
        return text


def _normal(field: str, text: str) -> object:
    text = text.strip()
    if field == "keywords":
        return [k.strip() for k in text.split(",") if k.strip()]
    if field == "track":
        return _track(text)
    return text


def _lookup_raw(raw: dict[str, str], name: str) -> str | None:
    if name in raw:
        return raw[name]
    folded = name.casefold()
    return next((v for k, v in raw.items() if k.casefold() == folded), None)


def _verify(
    before: dict,
    after: dict | None,
    before_duration: float | None,
    after_duration: float | None,
    changes: dict[str, str | None],
    family: str,
) -> str | None:
    """A message when the written file is not what was asked for, else None: same streams,
    same duration (a few hundredths of a second of drift is normal), every staged field
    reading back as requested and no other field changed."""
    if after is None:
        return "The file could not be read after writing."
    if len(after["streams"]) != len(before["streams"]):
        return "The number of streams in the file changed."
    if before_duration is not None and after_duration is not None:
        allowed = max(_DURATION_TOLERANCE_S, _DURATION_TOLERANCE_RATIO * before_duration)
        if abs(after_duration - before_duration) > allowed:
            return "The duration of the file changed."
    staged_fields = set()
    for key, value in changes.items():
        if key == "gps":
            if any(k.startswith(("GPS:", "XMP-exif:GPS")) for k in after["raw"]):
                return f"The file did not read back as expected: {label_of(key)}."
            continue
        if key.startswith(RAW_PREFIX):
            actual = _lookup_raw(after["raw"], key[len(RAW_PREFIX) :])
            ok = (
                actual is None
                if value is None
                else actual is not None and (actual.strip() == value.strip())
            )
        else:
            staged_fields.add(key)
            actual = after["fields"].get(key)
            if value is None:
                ok = actual is None
            else:
                expected = (
                    writers._exif_date(value) if key == "date" and family == "image" else value
                )
                ok = actual is not None and _normal(key, actual) == _normal(key, expected)
        if not ok:
            return (
                f"The file did not read back as expected: {label_of(key.removeprefix(RAW_PREFIX))}."
            )
    for field, old in before["fields"].items():
        if field in staged_fields:
            continue
        if _normal(field, after["fields"].get(field, "")) != _normal(field, old):
            return f"The file did not read back as expected: {label_of(field)} changed."
    return None


def _free_space_message(needed: int) -> str:
    return f"Not enough free space in the folder: about {needed // (1024 * 1024) + 1} MB needed."


def _apply_in_place(
    path: str,
    family: str,
    before: dict,
    before_duration: float | None,
    changes: dict[str, str | None],
) -> ApplyResult:
    snapshot = writers.write_mkv(path, changes)  # raises (already restored) if its tools fail
    message = _verify(
        before, _read_for_verify(path, family), before_duration, _duration(path), changes, family
    )
    if message is None:
        return ApplyResult("written")
    try:
        writers.restore_mkv(path, snapshot)
    except (writers.WriteError, OSError):
        return _failed(
            f"{message} The previous tags could not be restored: the file may be in a "
            "partial state."
        )
    return _failed(f"{message} The previous tags were restored.")


def _apply_rewrite(
    path: str,
    family: str,
    st: os.stat_result,
    before: dict,
    before_duration: float | None,
    changes: dict[str, str | None],
) -> ApplyResult:
    folder, name = os.path.split(path)
    if shutil.disk_usage(folder).free < st.st_size + _FREE_SPACE_MARGIN:
        return _failed(_free_space_message(st.st_size))
    ext = os.path.splitext(name)[1]
    tmp = os.path.join(folder, f".parallax-tags-{os.getpid()}-{threading.get_ident()}{ext}")
    try:
        if family == "ffmpeg":
            writers.edit_with_ffmpeg(path, tmp, changes)
        else:
            shutil.copy2(path, tmp)
            if family == "image":
                writers.write_image(tmp, changes)
            else:
                writers.edit_with_mutagen(tmp, changes)
        message = _verify(
            before, _read_for_verify(tmp, family), before_duration, _duration(tmp), changes, family
        )
        if message:
            return _failed(message)
        os.utime(tmp, ns=(st.st_atime_ns, st.st_mtime_ns))
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        with contextlib.suppress(OSError):  # ownership is best effort (not root, other owner)
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
        return ApplyResult("written")
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)


def _apply_locked(path: str, changes: dict[str, str | None]) -> ApplyResult:
    plan = plan_one(path)
    if not plan.writable:
        return _failed(plan.reason or "This file can't be edited.")
    _check_fields(path, plan, changes)
    family = family_of(path)
    st = os.stat(path)
    before = _read_for_verify(path, family or "")
    if before is None:
        return _failed("The file's current tags could not be read.")
    before_duration = None if family == "image" else _duration(path)
    if plan.how == "in_place":
        result = _apply_in_place(path, family or "", before, before_duration, changes)
    else:
        result = _apply_rewrite(path, family or "", st, before, before_duration, changes)
    if result.status == "written":
        logger.info("tags written: %s via %s, %d field(s)", family, plan.how, len(changes))
    return result


def apply_one(path: str, changes: dict[str, str | None]) -> ApplyResult:
    """Apply ``changes`` (canonical field or ``raw:<name>`` -> value, ``None`` clears) to one
    file. Never raises for a problem with that file: it comes back as ``failed`` with a
    message for the user, and the original is untouched unless the in-place tier says
    otherwise."""
    try:
        cleaned = _clean(changes)
        with _lock_for(path):
            return _apply_locked(path, cleaned)
    except writers.WriteError as e:
        return _failed(str(e))
    except OSError as e:
        logger.warning("tag write failed: %s", type(e).__name__)
        return _failed("The file could not be written. Check that it still exists and is writable.")
