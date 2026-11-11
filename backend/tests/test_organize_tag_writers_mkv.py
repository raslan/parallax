"""Matroska/WebM tag writing: mkvpropedit in place, global tags only, with a rollback.

Fixtures are built per test with ffmpeg; a test skips when ffmpeg or mkvtoolnix is missing.
"""

import os
import shutil
import subprocess
import xml.etree.ElementTree as ET

import pytest

from app.services import organize_tag_writers as writers
from app.services import organize_tags

pytestmark = [
    pytest.mark.skipif(
        shutil.which("ffmpeg") is None or shutil.which("mkvpropedit") is None,
        reason="ffmpeg or mkvtoolnix missing",
    )
]


def _mkv(path, *meta, track_meta=()):
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", "sine=d=1",
        "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10",
        "-c:v", "mpeg4",
    ]  # fmt: skip
    for kv in meta:
        cmd += ["-metadata", kv]
    for kv in track_meta:
        cmd += ["-metadata:s:v:0", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return str(path)


def _stream_md5(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0", "-c", "copy", "-f", "md5", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def _tags_xml(path):
    out = subprocess.run(["mkvextract", "tags", path], capture_output=True, text=True)
    return ET.fromstring(out.stdout) if out.stdout.strip() else None


def _track_tags(path):
    """Every per-track tag as (track uid, name, value), sorted."""
    root = _tags_xml(path)
    rows = []
    for tag in root.findall("Tag") if root is not None else []:
        uid = tag.findtext("Targets/TrackUID")
        if uid is None:
            continue
        for s in tag.findall("Simple"):
            rows.append((uid, s.findtext("Name"), s.findtext("String")))
    return sorted(rows)


def _fields(path):
    return organize_tags.read_tags(path, full=True)["fields"]


def _raw(path):
    return organize_tags.read_tags(path, full=True)["raw"]


def test_mkv_edit_keeps_per_track_tags_and_streams(tmp_path):
    p = _mkv(
        tmp_path / "a.mkv",
        "artist=Old",
        "synopsis=gone soon",
        "comment=keep me",
        track_meta=("MYTRACK=tracktag",),
    )
    before_tracks = _track_tags(p)
    assert any(name == "MYTRACK" for _, name, _ in before_tracks)
    md5, ino = _stream_md5(p), os.stat(p).st_ino
    writers.write_mkv(p, {"artist": "New", "synopsis": None})
    f = _fields(p)
    assert f["artist"] == "New" and "synopsis" not in f and f["comment"] == "keep me"
    assert _track_tags(p) == before_tracks
    assert _stream_md5(p) == md5
    assert os.stat(p).st_ino == ino


def test_mkv_title_is_segment_title(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "title=Old")
    writers.write_mkv(p, {"title": "New title"})
    assert _fields(p)["title"] == "New title"
    writers.write_mkv(p, {"title": None})
    assert "title" not in _fields(p)


def test_mkv_clear_removes_tag(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "genre=Rock", "comment=c")
    writers.write_mkv(p, {"genre": None})
    f = _fields(p)
    assert "genre" not in f and f["comment"] == "c"


def test_mkv_clear_of_the_last_tag_leaves_no_tags(tmp_path):
    p = _mkv(tmp_path / "a.mkv")
    writers.write_mkv(p, {"comment": "only"})
    writers.write_mkv(p, {"comment": None})
    assert "comment" not in _fields(p)
    assert _stream_md5(p)


def test_mkv_every_canonical_field_roundtrips(tmp_path):
    p = _mkv(tmp_path / "a.mkv")
    values = {
        "title": "T",
        "description": "D",
        "synopsis": "S",
        "comment": "C",
        "artist": "A",
        "album": "Al",
        "album_artist": "AA",
        "genre": "G",
        "date": "2020-05-01",
        "track": "3/12",
    }
    writers.write_mkv(p, values)
    assert _fields(p) == values


def test_mkv_special_xml_characters_roundtrip(tmp_path):
    p = _mkv(tmp_path / "a.mkv")
    nasty = "a <b> & \"c\" 'd'\nline two \U0001f600 " + "x" * 3000
    writers.write_mkv(p, {"description": nasty, "comment": "]]> <!-- not a comment -->"})
    f = _fields(p)
    assert f["description"] == nasty
    assert f["comment"] == "]]> <!-- not a comment -->"


def test_mkv_raw_tag_edit_add_and_clear(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "MOOD=calm")
    writers.write_mkv(p, {"raw:MOOD": "tense", "raw:MY TAG": "spaced", "raw:Füße": "unicode"})
    raw = _raw(p)
    assert raw["MOOD"] == "tense" and raw["MY TAG"] == "spaced" and raw["Füße"] == "unicode"
    writers.write_mkv(p, {"raw:MOOD": None})
    assert "MOOD" not in _raw(p)


def test_mkv_names_match_case_insensitively(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "description=lower")
    writers.write_mkv(p, {"description": "new"})
    assert _fields(p)["description"] == "new"
    xml = _tags_xml(p)
    names = [s.findtext("Name") for s in xml.iter("Simple")]
    assert [n.lower() for n in names].count("description") == 1


def test_mkv_canonical_field_it_cannot_hold_is_refused(tmp_path):
    p = _mkv(tmp_path / "a.mkv")
    with pytest.raises(writers.WriteError, match="[Cc]opyright"):
        writers.write_mkv(p, {"copyright": "x"})


def test_webm_title_edit_still_webm_doctype(tmp_path):
    p = tmp_path / "a.webm"
    r = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10",
            "-c:v", "libvpx", str(p),
        ],
        capture_output=True,
    )  # fmt: skip
    if r.returncode != 0:
        pytest.skip("ffmpeg has no VP8 encoder")
    writers.write_mkv(str(p), {"title": "Clip", "comment": "c"})
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=format_name", "-of", "csv=p=0", str(p)],
        capture_output=True,
        text=True,
    )
    assert "webm" in probe.stdout
    assert _fields(str(p))["title"] == "Clip"
    assert b"webm" in p.read_bytes()[:64]


def test_mkv_in_place_preserves_mtime_and_mode(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "artist=A")
    os.chmod(p, 0o640)
    os.utime(p, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
    before = os.stat(p)
    writers.write_mkv(p, {"artist": "B", "title": "T"})
    after = os.stat(p)
    assert after.st_mtime_ns == before.st_mtime_ns
    assert after.st_mode == before.st_mode


def test_mkv_bad_xml_never_runs_tool(tmp_path, monkeypatch):
    p = _mkv(tmp_path / "a.mkv", "artist=A")
    original = open(p, "rb").read()
    calls = []
    real = writers._run_tool

    def spy(cmd, **kw):
        calls.append(cmd[0])
        return real(cmd, **kw)

    monkeypatch.setattr(writers, "_run_tool", spy)
    monkeypatch.setattr(writers, "_build_tags_xml", lambda *a, **k: "<Tags><Tag>")
    with pytest.raises(writers.WriteError):
        writers.write_mkv(p, {"artist": "B"})
    assert "mkvpropedit" not in calls
    assert open(p, "rb").read() == original


def test_mkv_xml_temp_file_is_removed_even_when_writing_it_fails(tmp_path, monkeypatch):
    import tempfile

    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))
    real = tempfile.NamedTemporaryFile

    def failing(*a, **k):
        f = real(*a, **k)
        f.write = lambda *_a, **_k: (_ for _ in ()).throw(OSError("disk full"))
        return f

    monkeypatch.setattr(tempfile, "NamedTemporaryFile", failing)
    p = _mkv(tmp_path / "a.mkv", "artist=A")
    with pytest.raises((OSError, writers.WriteError)):
        writers.write_mkv(p, {"artist": "B"})
    assert list(scratch.iterdir()) == []


def test_mkv_restore_puts_back_tags_and_title(tmp_path):
    p = _mkv(tmp_path / "a.mkv", "title=Seg", "artist=A", "comment=c")
    before_tracks, md5 = _track_tags(p), _stream_md5(p)
    snap = writers.write_mkv(p, {"artist": "Z", "title": "Other", "comment": None, "raw:X": "y"})
    assert _fields(p)["artist"] == "Z"
    writers.restore_mkv(p, snap)
    f = _fields(p)
    assert f["title"] == "Seg" and f["artist"] == "A" and f["comment"] == "c"
    assert "X" not in _raw(p)
    assert _track_tags(p) == before_tracks and _stream_md5(p) == md5


def test_mkv_restore_when_file_originally_had_no_tags(tmp_path):
    p = _mkv(tmp_path / "a.mkv")
    subprocess.run(["mkvpropedit", p, "--tags", "global:"], check=True, capture_output=True)

    def global_tags():
        root = _tags_xml(p)
        return [
            t
            for t in (root.findall("Tag") if root is not None else [])
            if t.find("Targets/TrackUID") is None
        ]

    assert global_tags() == []
    track_before = _track_tags(p)
    snap = writers.write_mkv(p, {"artist": "A", "title": "T"})
    assert _fields(p)["artist"] == "A"
    writers.restore_mkv(p, snap)
    f = _fields(p)
    assert "artist" not in f and "title" not in f
    assert global_tags() == [] and _track_tags(p) == track_before


def test_mkv_tool_failure_midway_is_restored(tmp_path, monkeypatch):
    p = _mkv(tmp_path / "a.mkv", "title=Seg", "artist=A")
    real = writers._run_tool
    state = {"failed": False}

    def fail_title(cmd, **kw):  # only the first title edit fails, the restore's goes through
        if cmd[0] == "mkvpropedit" and "--edit" in cmd and not state["failed"]:
            state["failed"] = True
            raise writers.WriteError("boom")
        return real(cmd, **kw)

    monkeypatch.setattr(writers, "_run_tool", fail_title)
    with pytest.raises(writers.WriteError, match="restored"):
        writers.write_mkv(p, {"artist": "Z", "title": "New"})
    monkeypatch.setattr(writers, "_run_tool", real)
    f = _fields(p)
    assert f["artist"] == "A" and f["title"] == "Seg"


def test_mkv_restore_failure_is_reported_plainly(tmp_path, monkeypatch):
    p = _mkv(tmp_path / "a.mkv", "artist=A")
    real = writers._run_tool
    state = {"calls": 0}

    def flaky(cmd, **kw):
        if cmd[0] == "mkvpropedit":
            state["calls"] += 1
            if state["calls"] >= 2:  # the first call is the edit, the rest are the restore
                raise writers.WriteError("boom")
        return real(cmd, **kw)

    monkeypatch.setattr(writers, "_run_tool", flaky)
    with pytest.raises(writers.WriteError, match="partial state"):
        writers.write_mkv(p, {"artist": "Z", "title": "New"})
