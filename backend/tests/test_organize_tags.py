"""Reading embedded tags for Organize: ffprobe for video/audio, exiftool for images.

Fixtures are built per test with ffmpeg (lavfi) and Pillow, never from checked-in media;
a test skips when the tool it needs is missing.
"""

import shutil
import subprocess

import pytest
from PIL import Image

from app.services import organize_tags

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
)
needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="exiftool missing")


def _media(path, *meta, video=False):
    """A one-second sine (or a tiny test video with audio) tagged with `-metadata k=v`."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1"]
    if video:
        cmd += ["-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10", "-c:v", "mpeg4"]
    for kv in meta:
        cmd += ["-metadata", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return path


@needs_ffmpeg
def test_mp3_fields_raw_and_streams(tmp_path):
    p = _media(tmp_path / "a.mp3", "title=T", "artist=A")
    out = organize_tags.read_tags(str(p))
    assert out["fields"] == {"title": "T", "artist": "A"}
    assert out["raw"]["title"] == "T"
    assert out["streams"][0].startswith("audio mp3")
    assert out["truncated"] is False


@needs_ffmpeg
def test_long_description_is_capped_unless_full(tmp_path):
    text = "#tag " * 240  # 1,200 characters
    p = _media(tmp_path / "v.mkv", f"description={text}", video=True)
    capped = organize_tags.read_tags(str(p))
    assert len(capped["fields"]["description"]) == organize_tags.VALUE_CAP + 1
    assert capped["fields"]["description"].endswith("…")
    assert capped["truncated"] is True
    full = organize_tags.read_tags(str(p), full=True)
    assert full["fields"]["description"] == text.strip()
    assert full["truncated"] is False


def test_same_tag_in_two_spellings_is_one_field_first_spelling_wins():
    fields, raw, truncated = organize_tags.fields_from_tags(
        {"DESCRIPTION": "#a", "description": "b", "Title": "T"}, full=True
    )
    assert fields == {"description": "#a", "title": "T"}
    assert raw == {"DESCRIPTION": "#a", "Title": "T"}
    assert truncated is False


def test_blank_and_whitespace_values_read_as_absent():
    fields, raw, _ = organize_tags.fields_from_tags(
        {"title": "   ", "artist": "", "album": "A"}, full=True
    )
    assert fields == {"album": "A"}
    assert raw == {"album": "A"}


def test_description_alias_and_album_artist_alias():
    fields, _, _ = organize_tags.fields_from_tags({"desc": "D", "albumartist": "AA"}, full=True)
    assert fields == {"description": "D", "album_artist": "AA"}


@pytest.mark.parametrize("name", ["notes.txt", "missing.mp3", ".hidden.mp3"])
def test_other_missing_and_hidden_files_are_none(tmp_path, name):
    (tmp_path / "notes.txt").write_text("x")
    (tmp_path / ".hidden.mp3").write_bytes(b"x")
    assert organize_tags.read_tags(str(tmp_path / name)) is None


def test_symlink_is_none(tmp_path):
    target = tmp_path / "t.mp3"
    target.write_bytes(b"x")
    link = tmp_path / "l.mp3"
    link.symlink_to(target)
    assert organize_tags.read_tags(str(link)) is None


@needs_ffmpeg
def test_get_tags_maps_every_path_including_failures(tmp_path):
    ok = _media(tmp_path / "a.mp3", "title=T")
    out = organize_tags.get_tags([str(ok), str(tmp_path / "gone.mp3")])
    assert out[str(ok)]["fields"] == {"title": "T"}
    assert out[str(tmp_path / "gone.mp3")] is None


@needs_exiftool
def test_jpeg_canonical_fields_prefer_xmp_then_exif_then_iptc(tmp_path):
    p = tmp_path / "p.jpg"
    Image.new("RGB", (8, 8)).save(p)
    subprocess.run(
        [
            "exiftool",
            "-overwrite_original",
            "-XMP-dc:Title=X",
            "-IPTC:Caption-Abstract=D",
            "-EXIF:Artist=Z",
            "-XMP-dc:Subject=a",
            "-XMP-dc:Subject=b",
            str(p),
        ],
        check=True,
        capture_output=True,
    )
    out = organize_tags.read_tags(str(p), full=True)
    assert out["fields"]["title"] == "X"
    assert out["fields"]["description"] == "D"
    assert out["fields"]["artist"] == "Z"
    assert out["fields"]["keywords"] == "a, b"
    assert any(k.startswith("XMP-dc:") for k in out["raw"])
