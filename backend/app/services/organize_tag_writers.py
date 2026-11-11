"""The tag writers for Organize's tag editing, one per family (see ``organize_tag_plan``).

Every writer takes ``changes``: ``{field: value | None}`` where the key is a canonical field
(``title``, ``artist``, ...) or ``raw:<name>`` and ``None`` clears. Writers touch only what
is named and raise ``WriteError`` with a user-facing message. Tag text never goes to logs.

Callers must have sandboxed paths already. Blocking: call via a threadpool.
"""

import copy
import json
import logging
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.services.organize_tag_plan import (
    MKV_NAMES,
    RAW_PREFIX,
    is_global_tag,
    label_of,
    mkv_tags_root,
)

logger = logging.getLogger(__name__)

_TOOL_TIMEOUT_S = 60


class WriteError(Exception):
    """A write that did not happen (or was undone). The message is meant for the user."""


def _run_tool(cmd: list[str], *, ok_codes: tuple[int, ...] = (0,)) -> bytes:
    """Run an external tool; its stdout on success. Failure is a generic message: the tool's
    own output can carry file names or tag text."""
    try:
        done = subprocess.run(cmd, capture_output=True, timeout=_TOOL_TIMEOUT_S, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning("%s could not run: %s", cmd[0], type(e).__name__)
        raise WriteError("The tags could not be written: a required tool could not run.") from e
    if done.returncode not in ok_codes:
        logger.warning("%s failed with exit code %s", cmd[0], done.returncode)
        raise WriteError("The tags could not be written: the tool reported an error.")
    return done.stdout


def _preserve_times(path: str, before: os.stat_result) -> None:
    try:
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    except OSError:
        logger.warning("could not restore a file's modification time")


# --- Matroska / WebM: mkvpropedit in place, global tags only ----------------------------


@dataclass(frozen=True)
class MkvSnapshot:
    """What a Matroska file had before a write, kept in memory so a failed write can be
    undone. ``global_xml`` is None when the file had no global tags."""

    global_xml: str | None
    title: str | None


def _tags_document(tags: list[ET.Element]) -> str:
    root = ET.Element("Tags")
    root.extend(tags)
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def _global_tags(path: str) -> list[ET.Element]:
    try:
        root = mkv_tags_root(path)
    except (OSError, subprocess.SubprocessError, ET.ParseError) as e:
        raise WriteError("The file's current tags could not be read.") from e
    return [t for t in (root.findall("Tag") if root is not None else []) if is_global_tag(t)]


def _segment_title(path: str) -> str | None:
    out = _run_tool(["mkvmerge", "-J", path], ok_codes=(0, 1))
    try:
        return json.loads(out)["container"]["properties"].get("title")
    except (ValueError, KeyError, TypeError) as e:
        raise WriteError("The file's current title could not be read.") from e


def mkv_snapshot(path: str) -> MkvSnapshot:
    tags = _global_tags(path)
    return MkvSnapshot(_tags_document(tags) if tags else None, _segment_title(path))


def _split_mkv_changes(
    changes: dict[str, str | None],
) -> tuple[dict[str, str | None], bool, str | None]:
    """``(tag changes by Matroska name, title given, new title)``."""
    tags: dict[str, str | None] = {}
    has_title, title = False, None
    for key, value in changes.items():
        if key.startswith(RAW_PREFIX):
            tags[key[len(RAW_PREFIX) :]] = value
        elif key == "title":
            has_title, title = True, value
        elif key in MKV_NAMES:
            tags[MKV_NAMES[key]] = value
        else:
            raise WriteError(f"{label_of(key)} can't be stored in this file.")
    return tags, has_title, title


def _simples(tags: list[ET.Element], name: str) -> list[tuple[ET.Element, ET.Element]]:
    folded = name.casefold()
    return [
        (tag, simple)
        for tag in tags
        for simple in tag.findall("Simple")
        if (simple.findtext("Name") or "").strip().casefold() == folded
    ]


def _build_tags_xml(global_tags: list[ET.Element], changes: dict[str, str | None]) -> str:
    """The XML ``mkvpropedit --tags global:`` should receive: every existing global tag
    with ``changes`` applied. A name matches case-insensitively (``description`` and
    ``DESCRIPTION`` are one tag)."""
    tags = copy.deepcopy(global_tags)
    for name, value in changes.items():
        found = _simples(tags, name)
        if value is None:
            for tag, simple in found:
                tag.remove(simple)
            continue
        if found:
            _, simple = found[0]
            for _, extra in found[1:]:
                for tag in tags:
                    if extra in list(tag):
                        tag.remove(extra)
        else:
            if not tags:
                tag = ET.SubElement(ET.Element("x"), "Tag")
                ET.SubElement(tag, "Targets")
                tags.append(tag)
            simple = ET.SubElement(tags[0], "Simple")
            ET.SubElement(simple, "Name").text = name
        for stale in simple.findall("Binary"):
            simple.remove(stale)
        string = simple.find("String")
        if string is None:
            string = ET.SubElement(simple, "String")
        string.text = value
    tags = [t for t in tags if t.findall("Simple")]
    return _tags_document(tags)


def _check_tags_xml(xml: str, changes: dict[str, str | None]) -> None:
    """Parse the XML back and require every change to read as asked, before any tool runs."""
    try:
        root = ET.fromstring(xml.encode("utf-8"))
    except ET.ParseError as e:
        raise WriteError("A value contains characters that Matroska tags can't store.") from e
    tags = [t for t in root.findall("Tag") if is_global_tag(t)]
    for name, value in changes.items():
        found = _simples(tags, name)
        if value is None:
            ok = not found
        else:
            ok = len(found) == 1 and found[0][1].findtext("String") == value
        if not ok:
            raise WriteError("A value could not be stored exactly as typed in this file.")


def _write_global_tags(path: str, xml: str | None) -> None:
    """Replace the file's global tags with ``xml`` (None or no tags removes them)."""
    has_tags = xml is not None and "<Simple>" in xml
    if not has_tags:
        _run_tool(["mkvpropedit", path, "--tags", "global:"], ok_codes=(0, 1))
        return
    with tempfile.NamedTemporaryFile("w", suffix=".xml", encoding="utf-8", delete=False) as f:
        f.write(xml)
    try:
        _run_tool(["mkvpropedit", path, "--tags", f"global:{f.name}"], ok_codes=(0, 1))
    finally:
        os.unlink(f.name)


def _write_title(path: str, title: str | None) -> None:
    edit = ["--delete", "title"] if title is None else ["--set", f"title={title}"]
    _run_tool(["mkvpropedit", path, "--edit", "info", *edit], ok_codes=(0, 1))


def restore_mkv(path: str, snapshot: MkvSnapshot) -> None:
    """Put a Matroska file's global tags and segment title back as the snapshot has them."""
    before = os.stat(path)
    _write_global_tags(path, snapshot.global_xml)
    _write_title(path, snapshot.title)
    _preserve_times(path, before)


def write_mkv(path: str, changes: dict[str, str | None]) -> MkvSnapshot:
    """Edit a Matroska/WebM file's global tags and segment title in place, leaving the media
    and every per-track tag alone. Returns the snapshot taken before the write so the caller
    can undo a later failed check. If the write itself fails after the file was touched, the
    snapshot is restored here and the error says so."""
    tag_changes, has_title, title = _split_mkv_changes(changes)
    before = os.stat(path)
    snapshot = mkv_snapshot(path)
    xml = None
    if tag_changes:
        xml = _build_tags_xml(_global_tags(path), tag_changes)
        _check_tags_xml(xml, tag_changes)
    touched = False
    try:
        if tag_changes:
            touched = True
            _write_global_tags(path, xml)
        if has_title:
            touched = True
            _write_title(path, title)
    except WriteError as error:
        if not touched:
            raise
        try:
            restore_mkv(path, snapshot)
        except (WriteError, OSError) as restore_error:
            raise WriteError(
                "The change failed and the previous tags could not be restored: "
                "the file may be in a partial state."
            ) from restore_error
        raise WriteError(
            "The change could not be completed; the previous tags were restored."
        ) from error
    _preserve_times(path, before)
    return snapshot
