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
    ID3_EXTRA,
    ID3_FRAMES,
    MKV_NAMES,
    MP4_ATOMS,
    MP4_EXTRA,
    MP4_FREEFORM_MEAN,
    RAW_PREFIX,
    VORBIS_NAMES,
    aliases_of,
    family_of,
    is_global_tag,
    label_of,
    mkv_tags_root,
    validate_raw_name,
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


# --- Audio and the mp4 family: mutagen, editing only the named frames/atoms -------------


def _check_raw_names(path: str, changes: dict[str, str | None]) -> None:
    for key in changes:
        if key.startswith(RAW_PREFIX):
            message = validate_raw_name(path, key[len(RAW_PREFIX) :])
            if message:
                raise WriteError(message)


def _unsupported(key: str) -> WriteError:
    return WriteError(f"{label_of(key)} can't be stored in this file.")


def _id3_target(key: str) -> tuple[str, str | None]:
    """``(frame id, TXXX description)`` for a change key."""
    if key.startswith(RAW_PREFIX):
        name = key[len(RAW_PREFIX) :]
        extra = ID3_EXTRA.get(name.casefold())
        return (extra, None) if extra else ("TXXX", name)
    spec = ID3_FRAMES.get(key)
    if spec is None:
        raise _unsupported(key)
    frame, _, desc = spec.partition(":")
    return frame, desc or None


def _edit_id3(path: str, changes: dict[str, str | None]) -> None:
    from mutagen import id3

    try:
        tags = id3.ID3(path)
    except id3.ID3NoHeaderError:
        tags = id3.ID3()
    # Keep the tag's own version: saving a 2.3 tag as 2.4 would rewrite frames nobody touched.
    version = tags.version[1] if tags.version[1] in (3, 4) else 4
    for key, value in changes.items():
        frame, desc = _id3_target(key)
        # A tool may have stored the field as a custom frame (ffmpeg writes a comment as
        # TXXX:comment): those spellings are the same tag to the reader, so they go too.
        stale = set(aliases_of(key))
        if frame == "TXXX" and desc:
            stale.add(desc.casefold())
        for existing in [f for f in tags.getall("TXXX") if f.desc.casefold() in stale]:
            tags.delall(f"TXXX:{existing.desc}")
        if frame == "TXXX":
            if value is not None:
                tags.add(id3.TXXX(encoding=3, desc=desc, text=[value]))
        elif frame == "COMM":
            for existing in [f for f in tags.getall("COMM") if f.desc == ""]:
                tags.delall(f"COMM:{existing.desc}:{existing.lang}")
            if value is not None:
                tags.add(id3.COMM(encoding=3, lang="eng", desc="", text=[value]))
        else:
            tags.delall(frame)
            if value is not None:
                tags.add(getattr(id3, frame)(encoding=3, text=[value]))
    tags.save(path, v2_version=version)


def _vorbis_names(key: str) -> tuple[str, ...]:
    if key.startswith(RAW_PREFIX):
        return (key[len(RAW_PREFIX) :],)
    if key == "description":
        raise WriteError(
            "Vorbis files keep one slot for the comment and the description: use Comment."
        )
    names = VORBIS_NAMES.get(key)
    if names is None:
        raise _unsupported(key)
    return names


def _edit_vorbis(path: str, changes: dict[str, str | None]) -> None:
    import mutagen

    audio = mutagen.File(path)
    if audio is None or not hasattr(audio, "add_tags"):
        raise WriteError("This file's tags could not be opened.")
    if audio.tags is None:
        audio.add_tags()
    for key, value in changes.items():
        for name in _vorbis_names(key):
            if name in audio.tags:  # keys match case-insensitively, every value of it goes
                del audio.tags[name]
            if value is not None:
                audio.tags[name] = [value]
    audio.save()


def _mp4_track(value: str) -> list[tuple[int, int]]:
    head, _, tail = value.strip().partition("/")
    if not head.strip().isdigit() or (tail and not tail.strip().isdigit()):
        raise WriteError("Track must be a number like 3 or 3/12.")
    return [(int(head), int(tail) if tail else 0)]


def _mp4_atom(key: str) -> tuple[str, bool]:
    """``(atom, is_freeform)`` for a change key."""
    if key.startswith(RAW_PREFIX):
        name = key[len(RAW_PREFIX) :]
        extra = MP4_EXTRA.get(name.casefold())
        return (extra, False) if extra else (f"----:{MP4_FREEFORM_MEAN}:{name}", True)
    atom = MP4_ATOMS.get(key)
    if atom is None:
        raise _unsupported(key)
    return atom, False


def _edit_mp4(path: str, changes: dict[str, str | None]) -> None:
    from mutagen.mp4 import MP4, MP4FreeForm

    audio = MP4(path)
    if audio.tags is None:
        audio.add_tags()
    for key, value in changes.items():
        atom, freeform = _mp4_atom(key)
        if value is None:
            audio.tags.pop(atom, None)
        elif freeform:
            audio.tags[atom] = [MP4FreeForm(value.encode("utf-8"))]
        elif atom == "trkn":
            audio.tags[atom] = _mp4_track(value)
        else:
            audio.tags[atom] = [value]
    audio.save()


_MUTAGEN_EDITORS = {"id3": _edit_id3, "vorbis": _edit_vorbis, "mp4": _edit_mp4}


def edit_with_mutagen(path: str, changes: dict[str, str | None]) -> None:
    """Edit ``path`` in place with mutagen, changing only the frames/atoms/comments named.
    ``apply_one`` calls this on a hidden temp copy, never on the user's file."""
    family = family_of(path)
    editor = _MUTAGEN_EDITORS.get(family or "")
    if editor is None:
        raise WriteError("This format can't be edited here.")
    _check_raw_names(path, changes)
    try:
        editor(path, changes)
    except WriteError:
        raise
    except Exception as e:  # mutagen raises MutagenError, ValueError, OSError, struct errors
        logger.warning("mutagen could not edit a file: %s", type(e).__name__)
        raise WriteError(
            "The tags could not be written: the file's tag data could not be saved."
        ) from e
