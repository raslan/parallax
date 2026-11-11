"""Which writer a file gets, and which tag names can be edited (Organize tag editing).

Fixtures are built per test with ffmpeg (lavfi) and Pillow; a test skips when the tool it
needs is missing.
"""

import os
import shutil
import subprocess

import pytest
from PIL import Image

from app.services import organize_tag_plan as plan

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
)
needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="exiftool missing")
needs_mkvtoolnix = pytest.mark.skipif(
    shutil.which("mkvextract") is None, reason="mkvtoolnix missing"
)

MEDIA_FIELDS = [
    "title",
    "description",
    "synopsis",
    "comment",
    "artist",
    "album",
    "album_artist",
    "genre",
    "date",
    "track",
]
IMAGE_FIELDS = ["title", "description", "artist", "copyright", "keywords", "date", "gps"]


def _media(path, *meta, video=False, vcodec="mpeg4"):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1"]
    if video:
        cmd += ["-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10", "-c:v", vcodec]
    for kv in meta:
        cmd += ["-metadata", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return path


def _image(path):
    Image.new("RGB", (8, 8), "red").save(path)
    return path


@needs_ffmpeg
@needs_mkvtoolnix
def test_plan_mkv_is_in_place(tmp_path):
    p = _media(tmp_path / "a.mkv", video=True)
    out = plan.plan_one(str(p))
    assert out.writable and out.how == "in_place"
    assert out.bytes_needed == 0 and out.note is None
    assert out.fields[: len(MEDIA_FIELDS)] == MEDIA_FIELDS


@needs_ffmpeg
@pytest.mark.parametrize("name", ["a.mp4", "a.m4a", "a.mp3", "a.flac", "a.ogg", "a.opus"])
def test_plan_mp4_m4a_mp3_flac_opus_are_rewrite(tmp_path, name):
    p = _media(tmp_path / name, video=name.endswith(".mp4"), vcodec="mpeg4")
    out = plan.plan_one(str(p))
    assert out.writable and out.how == "rewrite"
    assert out.bytes_needed == os.path.getsize(p)
    assert out.note is None
    assert out.fields[: len(MEDIA_FIELDS)] == MEDIA_FIELDS


@needs_exiftool
@pytest.mark.parametrize("name", ["a.jpg", "a.png", "a.webp", "a.gif"])
def test_plan_images_are_rewrite_with_image_fields(tmp_path, name):
    p = _image(tmp_path / name)
    out = plan.plan_one(str(p))
    assert out.writable and out.how == "rewrite"
    assert out.fields[: len(IMAGE_FIELDS)] == IMAGE_FIELDS
    assert "synopsis" not in out.fields
    assert out.note is None


def test_plan_image_exiftool_cannot_write_is_read_only_with_its_reason(tmp_path, monkeypatch):
    p = _image(tmp_path / "a.png")
    monkeypatch.setattr(plan, "_exiftool_writable", lambda: {".jpg"})
    out = plan.plan_one(str(p))
    assert not out.writable and out.how is None
    assert out.reason and "png" in out.reason.lower()


@needs_ffmpeg
@pytest.mark.parametrize("name", ["a.avi", "a.ts", "a.flv", "a.wmv", "a.mpg", "a.ogv"])
def test_plan_avi_ts_flv_wmv_mpg_are_rewrite_with_note(tmp_path, name):
    p = tmp_path / name
    p.write_bytes(b"\0" * 64)  # the plan only looks at the name and the size
    out = plan.plan_one(str(p))
    assert out.writable and out.how == "rewrite"
    assert out.note and "may not survive" in out.note
    assert out.bytes_needed == 64


def test_plan_unknown_video_container_is_read_only(tmp_path):
    p = tmp_path / "a.rmvb"
    p.write_bytes(b"\0" * 64)
    out = plan.plan_one(str(p))
    assert not out.writable and out.how is None
    assert "this format" in out.reason
    assert out.fields == []


def test_plan_can_add_raw_true_for_every_writable_file(tmp_path):
    a = tmp_path / "a.avi"
    a.write_bytes(b"\0")
    b = tmp_path / "a.rmvb"
    b.write_bytes(b"\0")
    assert plan.plan_one(str(a)).can_add_raw is True
    assert plan.plan_one(str(b)).can_add_raw is False


def test_plan_other_kind_not_writable(tmp_path):
    p = tmp_path / "notes.txt"
    p.write_text("x")
    out = plan.plan_one(str(p))
    assert not out.writable and out.reason


@needs_ffmpeg
@needs_mkvtoolnix
def test_plan_hard_linked_file_refuses_rewrite_but_not_in_place(tmp_path):
    mp3 = _media(tmp_path / "a.mp3")
    os.link(mp3, tmp_path / "b.mp3")
    mkv = _media(tmp_path / "a.mkv", video=True)
    os.link(mkv, tmp_path / "b.mkv")
    refused = plan.plan_one(str(mp3))
    assert not refused.writable and "hard link" in refused.reason.lower()
    assert plan.plan_one(str(mkv)).writable


@needs_ffmpeg
def test_plan_includes_existing_raw_tags_as_fields(tmp_path):
    from mutagen.id3 import ID3, TXXX

    p = _media(tmp_path / "a.mp3", "title=T")
    tags = ID3(p)
    tags.add(TXXX(encoding=3, desc="MOOD", text=["calm"]))
    tags.save()
    out = plan.plan_one(str(p))
    assert "raw:MOOD" in out.fields
    assert "raw:title" not in out.fields  # canonical names are never raw fields


def test_plan_hidden_symlink_missing_are_not_writable(tmp_path):
    hidden = tmp_path / ".a.mp3"
    hidden.write_bytes(b"x")
    real = tmp_path / "r.mp3"
    real.write_bytes(b"x")
    link = tmp_path / "l.mp3"
    link.symlink_to(real)
    for path in (hidden, link, tmp_path / "missing.mp3"):
        out = plan.plan_one(str(path))
        assert not out.writable and out.reason


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        ("a.mp3", "TITLE"),
        ("a.mkv", "description"),
        ("a.m4a", "Desc"),
        ("a.flac", "artist"),
        ("a.mp3", ""),
        ("a.mp3", "x" * 101),
        ("a.mp3", "bad\nname"),
        ("a.flac", "bad=name"),
        ("a.flac", "bäd"),
        ("a.avi", "bad=name"),
        ("a.jpg", "File:FileName"),
        ("a.jpg", "System:FilePermissions"),
        ("a.jpg", "Composite:Anything"),
        ("a.jpg", "Foo"),
        ("a.jpg", "XMP-dc:Source\n-File:FileName"),
        ("a.jpg", "XMP-dc:So=urce"),
    ],
)
def test_validate_raw_name_refuses(name, bad):
    assert plan.validate_raw_name(name, bad)


@pytest.mark.parametrize(
    ("name", "good"),
    [
        ("a.mp3", "MOOD"),
        ("a.mp3", "composer"),
        ("a.mkv", "MY TAG"),
        ("a.m4a", "iTunNORM"),
        ("a.flac", "REPLAYGAIN_TRACK_GAIN"),
        ("a.avi", "mood"),
        ("a.jpg", "XMP-dc:Source"),
        ("a.jpg", "IFD0:Make"),
        ("a.jpg", "GPS:GPSLatitude"),
        ("a.jpg", "IPTC:Source"),
    ],
)
def test_validate_raw_name_accepts(name, good):
    assert plan.validate_raw_name(name, good) is None


def test_canonical_alias_message_names_the_field():
    msg = plan.validate_raw_name("a.mp3", "TITLE")
    assert msg and "Title" in msg
