"""Image tag writing with exiftool (EXIF, XMP and IPTC together), measured against the spike.

Fixtures are built per test with Pillow and exiftool; a test skips when exiftool is missing.
"""

import hashlib
import json
import os
import shutil
import subprocess

import pytest
from PIL import Image

from app.services import organize_tag_writers as writers
from app.services import organize_tags

pytestmark = [pytest.mark.skipif(shutil.which("exiftool") is None, reason="exiftool missing")]


def _image(path, fmt=None):
    Image.new("RGB", (16, 16), "red").save(path, format=fmt)
    return str(path)


def _seed(path, *args):
    subprocess.run(
        ["exiftool", "-q", "-overwrite_original", "-charset", "iptc=utf8", *args, path],
        check=True,
    )


def _pixels(path):
    return hashlib.md5(Image.open(path).convert("RGB").tobytes()).hexdigest()


def _dump(path):
    out = subprocess.run(
        ["exiftool", "-j", "-G1", "-a", "-s", path], capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)[0]


def _fields(path):
    return organize_tags.read_tags(path, full=True)["fields"]


def test_image_description_goes_to_exif_xmp_and_iptc(tmp_path):
    p = _image(tmp_path / "a.jpg")
    _seed(
        p, "-IFD0:ImageDescription=exif", "-XMP-dc:Description=xmp", "-IPTC:Caption-Abstract=iptc"
    )
    writers.write_image(p, {"description": "NEW"})
    d = _dump(p)
    assert d["IFD0:ImageDescription"] == "NEW"
    assert d["XMP-dc:Description"] == "NEW"
    assert d["IPTC:Caption-Abstract"] == "NEW"
    assert _fields(p)["description"] == "NEW"


def test_image_title_artist_copyright_date_keywords_mapping(tmp_path):
    p = _image(tmp_path / "a.jpg")
    writers.write_image(
        p,
        {
            "title": "T",
            "artist": "Ann",
            "copyright": "(c) Ann",
            "date": "2020-05-01 10:30:00",
            "keywords": "a, b ,c",
        },
    )
    d = _dump(p)
    assert d["XMP-dc:Title"] == "T" and d["IPTC:ObjectName"] == "T"
    assert d["IFD0:Artist"] == "Ann" and d["XMP-dc:Creator"] == "Ann" and d["IPTC:By-line"] == "Ann"
    assert d["IFD0:Copyright"] == "(c) Ann" and d["XMP-dc:Rights"] == "(c) Ann"
    assert d["IPTC:CopyrightNotice"] == "(c) Ann"
    assert d["ExifIFD:DateTimeOriginal"] == "2020:05:01 10:30:00"
    assert d["XMP-dc:Subject"] == ["a", "b", "c"] and d["IPTC:Keywords"] == ["a", "b", "c"]
    f = _fields(p)
    assert f["title"] == "T" and f["keywords"] == "a, b, c"


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("2020-05-01", "2020:05:01 00:00:00"),
        ("2020:05:01", "2020:05:01 00:00:00"),
        ("2020-05-01 10:30", "2020:05:01 10:30:00"),
        ("2020-05-01T10:30:15", "2020:05:01 10:30:15"),
    ],
)
def test_image_date_is_normalised_to_the_exif_form(tmp_path, typed, stored):
    p = _image(tmp_path / "a.jpg")
    writers.write_image(p, {"date": typed})
    assert _dump(p)["ExifIFD:DateTimeOriginal"] == stored


def test_image_bad_date_is_refused_before_exiftool_runs(tmp_path, monkeypatch):
    p = _image(tmp_path / "a.jpg")
    monkeypatch.setattr(writers, "_run_exiftool", lambda *a, **k: pytest.fail("ran"))
    with pytest.raises(writers.WriteError, match="[Dd]ate"):
        writers.write_image(p, {"date": "last summer"})


def test_image_clear_gps_removes_gps_group(tmp_path):
    p = _image(tmp_path / "a.jpg")
    _seed(
        p,
        "-GPSLatitude=10.5", "-GPSLatitudeRef=N", "-GPSLongitude=20.5", "-GPSLongitudeRef=E",
        "-XMP-exif:GPSLatitude=3", "-XMP-exif:GPSLongitude=4", "-IFD0:Make=Cam",
    )  # fmt: skip
    assert any(k.startswith("GPS:") for k in _dump(p))
    writers.write_image(p, {"gps": None})
    d = _dump(p)
    assert not [k for k in d if k.startswith("GPS:") or k.startswith("XMP-exif:GPS")]
    assert d["IFD0:Make"] == "Cam"


def test_image_gps_can_only_be_cleared(tmp_path):
    p = _image(tmp_path / "a.jpg")
    with pytest.raises(writers.WriteError, match="GPS"):
        writers.write_image(p, {"gps": "1,2"})


@pytest.mark.parametrize("name", ["a.jpg", "a.png", "a.webp", "a.gif"])
def test_image_untouched_tags_and_pixels_survive(tmp_path, name):
    p = _image(tmp_path / name)
    _seed(p, "-XMP-photoshop:Credit=Keep", "-XMP-dc:Title=Old")
    if name.endswith(".jpg"):
        _seed(p, "-IFD0:Make=Cam")
    before = _dump(p)
    pixels = _pixels(p)
    writers.write_image(p, {"title": "New"})
    after = _dump(p)
    assert after["XMP-dc:Title"] == "New"
    assert after["XMP-photoshop:Credit"] == "Keep"
    if name.endswith(".jpg"):
        assert after["IFD0:Make"] == before["IFD0:Make"]
    assert _pixels(p) == pixels


def test_image_no_original_backup_left(tmp_path):
    p = _image(tmp_path / "a.jpg")
    writers.write_image(p, {"title": "T"})
    assert sorted(os.listdir(tmp_path)) == ["a.jpg"]


def test_image_clear_of_absent_tag_is_noop(tmp_path):
    p = _image(tmp_path / "a.png")
    pixels = _pixels(p)
    writers.write_image(p, {"description": None, "keywords": None, "raw:XMP-dc:Source": None})
    assert _pixels(p) == pixels
    assert _fields(p) == {}


@pytest.mark.parametrize(
    "nasty",
    [
        "-overwrite_original",
        "@file",
        "=x",
        "<b",
        "$x",
        "#[CSTR]a\\nb",
        "-TAG=1",
        "two\nlines",
        "Füße \U0001f600",
    ],
)
def test_image_value_that_looks_like_an_option_is_stored_literally(tmp_path, nasty):
    p = _image(tmp_path / "a.jpg")
    writers.write_image(p, {"title": nasty})
    assert _dump(p)["XMP-dc:Title"] == nasty
    assert sorted(os.listdir(tmp_path)) == ["a.jpg"]


def test_image_iptc_text_is_utf8(tmp_path):
    p = _image(tmp_path / "a.jpg")
    writers.write_image(p, {"artist": "Füße é"})
    out = subprocess.run(["exiftool", "-s3", "-IPTC:By-line", p], capture_output=True, text=True)
    assert out.stdout.strip() == "Füße é"


def test_image_value_over_an_iptc_limit_clears_the_iptc_copy_not_truncates(tmp_path):
    p = _image(tmp_path / "a.jpg")
    _seed(p, "-IPTC:ObjectName=stale")
    long_title = "x" * 80  # IPTC:ObjectName holds 64 bytes
    writers.write_image(p, {"title": long_title})
    d = _dump(p)
    assert d["XMP-dc:Title"] == long_title
    assert "IPTC:ObjectName" not in d  # cleared, never a stale or cut copy
    assert _fields(p)["title"] == long_title


def test_image_raw_tag_add_and_edit(tmp_path):
    p = _image(tmp_path / "a.jpg")
    _seed(p, "-IFD0:Make=Cam", "-XMP-photoshop:Credit=Keep")
    writers.write_image(p, {"raw:XMP-dc:Source": "src", "raw:IFD0:Make": "Other"})
    d = _dump(p)
    assert d["XMP-dc:Source"] == "src" and d["IFD0:Make"] == "Other"
    assert d["XMP-photoshop:Credit"] == "Keep"
    writers.write_image(p, {"raw:XMP-dc:Source": None})
    assert "XMP-dc:Source" not in _dump(p)


@pytest.mark.parametrize("name", ["File:FileName", "System:FilePermissions", "Composite:Foo"])
def test_image_raw_name_in_file_or_system_group_is_never_written(tmp_path, monkeypatch, name):
    p = _image(tmp_path / "a.jpg")
    mode = os.stat(p).st_mode
    monkeypatch.setattr(writers, "_run_exiftool", lambda *a, **k: pytest.fail("ran"))
    with pytest.raises(writers.WriteError):
        writers.write_image(p, {f"raw:{name}": "renamed.jpg"})
    assert os.listdir(tmp_path) == ["a.jpg"] and os.stat(p).st_mode == mode


@pytest.mark.parametrize("name", ["XMP-dc:Sou\nrce", "XMP-dc:So=urce"])
def test_image_raw_name_with_newline_or_equals_is_refused(tmp_path, monkeypatch, name):
    p = _image(tmp_path / "a.jpg")
    monkeypatch.setattr(writers, "_run_exiftool", lambda *a, **k: pytest.fail("ran"))
    with pytest.raises(writers.WriteError):
        writers.write_image(p, {f"raw:{name}": "x"})


def test_image_field_a_picture_cannot_hold_is_refused(tmp_path):
    p = _image(tmp_path / "a.jpg")
    with pytest.raises(writers.WriteError, match="[Ss]ynopsis"):
        writers.write_image(p, {"synopsis": "x"})


def test_image_exiftool_error_is_a_write_error_and_leaves_the_file(tmp_path):
    p = tmp_path / "a.jpg"
    p.write_bytes(b"not an image at all")
    before = p.read_bytes()
    with pytest.raises(writers.WriteError):
        writers.write_image(str(p), {"title": "T"})
    assert p.read_bytes() == before
