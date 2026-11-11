"""ffmpeg stream-copy rewrite for the few video/audio containers nothing else handles.

Each container keeps a different subset of the tags (measured, see organize_tag_plan);
fixtures are built per test and skip when ffmpeg cannot make that container.
"""

import os
import shutil
import subprocess

import pytest

from app.services import organize_tag_plan as plan
from app.services import organize_tag_writers as writers
from app.services import organize_tags

pytestmark = [
    pytest.mark.skipif(
        shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
    )
]

_V = ["-f", "lavfi", "-i", "sine=d=1", "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10"]
_A = ["-f", "lavfi", "-i", "sine=d=1"]
BUILD = {
    ".avi": (_V + ["-c:v", "mpeg4", "-c:a", "mp3"], "avi"),
    ".flv": (_V + ["-c:v", "flv1", "-c:a", "mp3", "-ar", "44100"], "flv"),
    ".wmv": (_V + ["-c:v", "wmv2", "-c:a", "wmav2"], "asf"),
    ".wma": (_A + ["-c:a", "wmav2"], "asf"),
    ".wav": (_A + ["-c:a", "pcm_s16le"], "wav"),
    ".aiff": (_A + ["-c:a", "pcm_s16be"], "aiff"),
}
VALUES = {
    "title": "T",
    "description": "D",
    "synopsis": "S",
    "comment": "C",
    "artist": "A",
    "album": "Al",
    "album_artist": "AA",
    "genre": "G",
    "date": "2020-05-01",
    "track": "3",
}


def _make(tmp_path, ext, *meta):
    args, fmt = BUILD[ext]
    path = str(tmp_path / f"src{ext}")
    cmd = ["ffmpeg", "-v", "error", "-y", *args]
    for kv in meta:
        cmd += ["-metadata", kv]
    r = subprocess.run([*cmd, "-f", fmt, path], capture_output=True)
    if r.returncode != 0:
        pytest.skip(f"ffmpeg cannot build {ext}")
    return path


def _md5(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0", "-c", "copy", "-f", "md5", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def _read(path):
    return organize_tags.read_tags(path, full=True)


@pytest.mark.parametrize("ext", list(BUILD))
def test_ffmpeg_tier_writes_every_offered_field_and_keeps_streams(tmp_path, ext):
    src = _make(tmp_path, ext)
    dest = str(tmp_path / f"dest{ext}")
    offered = plan.FFMPEG_FIELDS[ext]
    writers.edit_with_ffmpeg(src, dest, {f: VALUES[f] for f in offered})
    got = _read(dest)["fields"]
    assert got == {f: VALUES[f] for f in offered}
    assert _md5(dest) == _md5(src)
    assert os.path.exists(src)  # the source is only read


@pytest.mark.parametrize("ext", [".avi", ".flv", ".wmv", ".wav", ".aiff"])
def test_ffmpeg_tier_clear_removes_only_that_tag(tmp_path, ext):
    src = _make(tmp_path, ext, "title=Keep", "comment=Drop")
    dest = str(tmp_path / f"dest{ext}")
    writers.edit_with_ffmpeg(src, dest, {"comment": None})
    got = _read(dest)["fields"]
    assert got.get("title") == "Keep" and "comment" not in got


@pytest.mark.parametrize("ext", [".flv", ".wmv", ".wma"])
def test_ffmpeg_tier_raw_tag_add_and_clear(tmp_path, ext):
    src = _make(tmp_path, ext, "title=T")
    dest = str(tmp_path / f"dest{ext}")
    writers.edit_with_ffmpeg(src, dest, {"raw:MOOD": "calm"})
    raw = {k.lower(): v for k, v in _read(dest)["raw"].items()}
    assert raw["mood"] == "calm"
    dest2 = str(tmp_path / f"dest2{ext}")
    writers.edit_with_ffmpeg(dest, dest2, {"raw:MOOD": None})
    assert "mood" not in {k.lower() for k in _read(dest2)["raw"]}


@pytest.mark.parametrize("ext", [".avi", ".wav", ".aiff"])
def test_ffmpeg_tier_refuses_custom_names_where_fields_are_fixed(tmp_path, ext):
    src = _make(tmp_path, ext)
    with pytest.raises(writers.WriteError, match="fixed"):
        writers.edit_with_ffmpeg(src, str(tmp_path / f"d{ext}"), {"raw:MOOD": "x"})


def test_ffmpeg_tier_refuses_a_field_the_container_cannot_hold(tmp_path):
    src = _make(tmp_path, ".avi")
    with pytest.raises(writers.WriteError, match="[Aa]lbum"):
        writers.edit_with_ffmpeg(src, str(tmp_path / "d.avi"), {"album": "x"})
    assert not os.path.exists(tmp_path / "d.avi")


def test_ffmpeg_tier_value_with_newline_and_equals_roundtrips(tmp_path):
    src = _make(tmp_path, ".flv")
    dest = str(tmp_path / "d.flv")
    text = "a=b\nc = d &lt; <x> Füße"
    writers.edit_with_ffmpeg(src, dest, {"comment": text})
    assert _read(dest)["fields"]["comment"] == text


def test_ffmpeg_tier_failure_is_a_write_error_and_leaves_no_output(tmp_path):
    src = tmp_path / "bad.avi"
    src.write_bytes(b"not a video")
    dest = tmp_path / "d.avi"
    with pytest.raises(writers.WriteError):
        writers.edit_with_ffmpeg(str(src), str(dest), {"title": "T"})
    assert not dest.exists()


@pytest.mark.parametrize("name", ["a.mkv", "a.mp4", "a.mp3", "a.flac", "a.jpg", "a.ts"])
def test_ffmpeg_tier_is_never_used_for_formats_with_a_better_writer(tmp_path, name):
    with pytest.raises(writers.WriteError, match="can't be edited here"):
        writers.edit_with_ffmpeg(str(tmp_path / name), str(tmp_path / "out"), {"title": "T"})
