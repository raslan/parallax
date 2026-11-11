"""Tag writing with mutagen for audio and the mp4 family (edits a copy, only what is named).

Fixtures are built per test with ffmpeg; a test skips when the tool or an encoder is missing.
"""

import shutil
import subprocess

import mutagen
import pytest
from mutagen.id3 import (
    APIC,
    COMM,
    ID3,
    POPM,
    PRIV,
    TALB,
    TBPM,
    TCOM,
    TCON,
    TDRC,
    TPE1,
    TPOS,
    TRCK,
    TXXX,
    USLT,
    WXXX,
)
from mutagen.mp4 import MP4, MP4FreeForm

from app.services import organize_tag_writers as writers
from app.services import organize_tags

pytestmark = [
    pytest.mark.skipif(
        shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
    )
]

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63"
    "00010000050001a5f645400000000049454e44ae426082"
)

CONTAINERS = {
    "mp3": ("a.mp3", ["-c:a", "libmp3lame"]),
    "flac": ("a.flac", ["-c:a", "flac"]),
    "ogg": ("a.ogg", ["-c:a", "libvorbis"]),
    "opus": ("a.opus", ["-c:a", "libopus"]),
    "m4a": ("a.m4a", ["-c:a", "aac"]),
}


def _audio(path, codec_args, *meta):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1", *codec_args]
    for kv in meta:
        cmd += ["-metadata", kv]
    r = subprocess.run([*cmd, str(path)], capture_output=True)
    if r.returncode != 0:
        pytest.skip(f"ffmpeg cannot build {path}: {r.stderr[-80:]!r}")
    return str(path)


def _video(path, *extra):
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", "sine=d=1", "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10",
        "-c:v", "mpeg4", "-c:a", "aac", *extra,
    ]  # fmt: skip
    r = subprocess.run([*cmd, str(path)], capture_output=True)
    if r.returncode != 0:
        pytest.skip(f"ffmpeg cannot build {path}")
    return str(path)


def _payload_md5(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def _tags_view(path):
    """mutagen's own view of every tag, as comparable strings."""
    audio = mutagen.File(path)
    tags = audio.tags
    if tags is None:
        return {}
    if isinstance(tags, ID3):
        return {
            k: v.pprint() + (repr(v.data) if isinstance(v, APIC) else "") for k, v in tags.items()
        }
    return {k: repr(v) for k, v in tags.items()}


def _fields(path):
    return organize_tags.read_tags(path, full=True)["fields"]


def _raw(path):
    return organize_tags.read_tags(path, full=True)["raw"]


@pytest.mark.parametrize("fmt", list(CONTAINERS))
def test_edit_changes_only_staged_fields(tmp_path, fmt):
    name, codec = CONTAINERS[fmt]
    p = _audio(tmp_path / name, codec, "title=Old", "artist=Art", "album=Alb", "comment=gone")
    before = _tags_view(p)
    md5 = _payload_md5(p)
    writers.edit_with_mutagen(p, {"title": "New", "comment": None})
    f = _fields(p)
    assert f["title"] == "New" and "comment" not in f
    assert f["artist"] == "Art" and f["album"] == "Alb"
    after = _tags_view(p)
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    # Only the title and comment entries differ; every other frame/atom/comment is untouched.
    assert all(
        any(
            t in k.lower()
            for t in ("title", "tit2", "nam", "comment", "comm", "cmt", "description")
        )
        for k in changed
    ), changed
    assert _payload_md5(p) == md5


def test_rich_mp3_keeps_lyrics_rating_comment_url_cover_private_frames(tmp_path):
    """The spec's permanent regression: an ffmpeg rewrite drops USLT/POPM/COMM/WXXX."""
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"], "title=T")
    tags = ID3(p)
    tags.add(TPE1(encoding=3, text=["Artist"]))
    tags.add(TALB(encoding=3, text=["Album"]))
    tags.add(TRCK(encoding=3, text=["3/12"]))
    tags.add(TPOS(encoding=3, text=["1/2"]))
    tags.add(TCON(encoding=3, text=["Rock"]))
    tags.add(TDRC(encoding=3, text=["2020-05-01"]))
    tags.add(TCOM(encoding=3, text=["Composer"]))
    tags.add(TBPM(encoding=3, text=["120"]))
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["a comment"]))
    tags.add(USLT(encoding=3, lang="eng", desc="", text="la la la"))
    tags.add(POPM(email="a@b.c", rating=196, count=7))
    tags.add(WXXX(encoding=3, desc="", url="https://example.com"))
    tags.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=PNG))
    tags.add(PRIV(owner="com.example", data=b"\x01\x02\x03"))
    tags.add(TXXX(encoding=3, desc="MOOD", text=["calm"]))
    tags.save(p)
    before = _tags_view(p)
    assert len({k.split(":")[0] for k in before}) >= 15
    md5 = _payload_md5(p)
    writers.edit_with_mutagen(p, {"title": "Changed"})
    after = _tags_view(p)
    assert _fields(p)["title"] == "Changed"
    for key in before:
        if key.startswith("TIT2"):
            continue
        assert after[key] == before[key], key
    assert set(after) == set(before)
    assert _payload_md5(p) == md5


def test_id3_version_is_kept(tmp_path):
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame", "-id3v2_version", "3"], "title=T")
    assert ID3(p).version[1] == 3
    writers.edit_with_mutagen(p, {"artist": "A"})
    assert ID3(p).version[1] == 3


def test_mp3_without_id3_header_gets_one(tmp_path):
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame", "-write_id3v2", "0", "-write_xing", "0"])
    md5 = _payload_md5(p)
    writers.edit_with_mutagen(p, {"title": "T", "artist": "A"})
    assert _fields(p) == {"title": "T", "artist": "A"}
    assert _payload_md5(p) == md5


def test_flac_with_picture_keeps_the_picture(tmp_path):
    p = _audio(tmp_path / "a.flac", ["-c:a", "flac"], "title=T")
    audio = mutagen.File(p)
    pic = mutagen.flac.Picture()
    pic.data, pic.type, pic.mime, pic.width, pic.height, pic.depth = PNG, 3, "image/png", 1, 1, 24
    audio.add_picture(pic)
    audio.save()
    writers.edit_with_mutagen(p, {"title": "New"})
    after = mutagen.File(p)
    assert len(after.pictures) == 1 and after.pictures[0].data == PNG
    assert _fields(p)["title"] == "New"


def test_vorbis_multi_value_field_replaced_not_duplicated(tmp_path):
    p = _audio(tmp_path / "a.flac", ["-c:a", "flac"])
    audio = mutagen.File(p)
    audio.tags["ARTIST"] = ["One", "Two"]
    audio.save()
    writers.edit_with_mutagen(p, {"artist": "Solo"})
    assert mutagen.File(p).tags["ARTIST"] == ["Solo"]


def test_m4a_keeps_freeform_atoms_and_rating(tmp_path):
    p = _audio(tmp_path / "a.m4a", ["-c:a", "aac"], "title=T")
    m = MP4(p)
    m["----:com.apple.iTunes:MOOD"] = [MP4FreeForm(b"calm")]
    m["----:com.apple.iTunes:iTunNORM"] = [MP4FreeForm(b" 00000000 00000000")]
    m["rtng"] = [1]
    m["trkn"] = [(3, 12)]
    m["ldes"] = ["long description"]
    m.save()
    before = _tags_view(p)
    writers.edit_with_mutagen(p, {"title": "New", "synopsis": None})
    after = MP4(p)
    assert after["\xa9nam"] == ["New"] and "ldes" not in after
    for key in ("----:com.apple.iTunes:MOOD", "----:com.apple.iTunes:iTunNORM", "rtng", "trkn"):
        assert repr(after[key]) == before[key], key


@pytest.mark.parametrize("moov_first", [True, False])
def test_mp4_moov_first_and_last_both_edit_cleanly(tmp_path, moov_first):
    flags = ["-movflags", "+faststart"] if moov_first else []
    p = _video(tmp_path / "a.mp4", *flags)
    md5 = _payload_md5(p)
    big = "x" * 3000  # grows the moov, so the chunk offsets must move
    writers.edit_with_mutagen(p, {"title": "T", "description": big})
    decode = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", p, "-f", "null", "-"], capture_output=True, text=True
    )
    assert decode.stderr == ""
    assert _fields(p)["description"] == big
    assert _payload_md5(p) == md5


@pytest.mark.parametrize("ext", ["mov", "3gp", "m4v"])
def test_other_mp4_family_extensions_roundtrip_or_are_not_in_the_family(tmp_path, ext):
    """Anything the plan routes to mutagen must read back through ffprobe."""
    from app.services import organize_tag_plan as plan

    p = _video(tmp_path / f"a.{ext}")
    if plan.family_of(p) != "mp4":
        return
    writers.edit_with_mutagen(p, {"title": "Round", "artist": "Trip"})
    f = _fields(p)
    assert f.get("title") == "Round" and f.get("artist") == "Trip"


@pytest.mark.parametrize("fmt", list(CONTAINERS))
def test_every_canonical_field_roundtrips(tmp_path, fmt):
    name, codec = CONTAINERS[fmt]
    p = _audio(tmp_path / name, codec)
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
    if fmt in ("flac", "ogg", "opus"):
        del values["description"]  # one slot with the comment in Vorbis files
    writers.edit_with_mutagen(p, values)
    assert _fields(p) == values


@pytest.mark.parametrize("fmt", ["flac", "ogg", "opus"])
def test_vorbis_comment_goes_to_both_names_and_description_is_refused(tmp_path, fmt):
    name, codec = CONTAINERS[fmt]
    p = _audio(tmp_path / name, codec, "comment=old")
    with pytest.raises(writers.WriteError, match="Comment"):
        writers.edit_with_mutagen(p, {"description": "x"})
    writers.edit_with_mutagen(p, {"comment": "new"})
    tags = mutagen.File(p).tags
    assert tags["COMMENT"] == ["new"] and tags["DESCRIPTION"] == ["new"]
    assert _fields(p)["comment"] == "new"
    writers.edit_with_mutagen(p, {"comment": None})
    tags = mutagen.File(p).tags
    assert "COMMENT" not in tags and "DESCRIPTION" not in tags
    assert "comment" not in _fields(p)


def test_id3_comment_stored_as_a_custom_frame_is_replaced_not_shadowed(tmp_path):
    """ffmpeg writes a comment as TXXX:comment; an edit must not leave it beside a new COMM."""
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"], "comment=old")
    assert any(k.lower() == "txxx:comment" for k in ID3(p))
    writers.edit_with_mutagen(p, {"comment": "new"})
    tags = ID3(p)
    assert not [k for k in tags if k.lower() == "txxx:comment"]
    assert _fields(p)["comment"] == "new"


@pytest.mark.parametrize("fmt", ["mp3", "flac", "m4a"])
def test_track_and_date_text_roundtrip(tmp_path, fmt):
    name, codec = CONTAINERS[fmt]
    p = _audio(tmp_path / name, codec)
    for track, date in (("3", "2020"), ("3/12", "2020-05-01")):
        writers.edit_with_mutagen(p, {"track": track, "date": date})
        f = _fields(p)
        assert f["track"].split("/")[0] == "3" and f["date"] == date


def test_mp4_track_must_be_a_number(tmp_path):
    p = _audio(tmp_path / "a.m4a", ["-c:a", "aac"])
    with pytest.raises(writers.WriteError, match="[Tt]rack"):
        writers.edit_with_mutagen(p, {"track": "three"})


def test_raw_tag_edit_and_add_per_format(tmp_path):
    mp3 = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"], "title=T")
    flac = _audio(tmp_path / "a.flac", ["-c:a", "flac"], "title=T")
    m4a = _audio(tmp_path / "a.m4a", ["-c:a", "aac"], "title=T")
    t = ID3(mp3)
    t.add(TXXX(encoding=3, desc="MOOD", text=["calm"]))
    t.add(TCOM(encoding=3, text=["Old composer"]))
    t.save(mp3)
    f = mutagen.File(flac)
    f.tags["MOOD"] = ["calm"]
    f.save()
    m = MP4(m4a)
    m["----:com.apple.iTunes:MOOD"] = [MP4FreeForm(b"calm")]
    m.save()
    for p in (mp3, flac, m4a):
        before_title = _fields(p)["title"]
        writers.edit_with_mutagen(p, {"raw:MOOD": "tense", "raw:NEWTAG": "added"})
        raw = {k.lower(): v for k, v in _raw(p).items()}
        assert raw["mood"] == "tense" and raw["newtag"] == "added", p
        assert _fields(p)["title"] == before_title
        writers.edit_with_mutagen(p, {"raw:MOOD": None})
        assert "mood" not in {k.lower() for k in _raw(p)}
    # A real frame ffprobe names "composer" is edited in place, never duplicated as TXXX.
    writers.edit_with_mutagen(mp3, {"raw:composer": "New composer"})
    tags = ID3(mp3)
    assert str(tags["TCOM"]) == "New composer"
    assert not [k for k in tags if k.lower() == "txxx:composer"]


def test_raw_name_of_a_canonical_alias_is_refused(tmp_path):
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"], "title=T")
    with pytest.raises(writers.WriteError, match="Title"):
        writers.edit_with_mutagen(p, {"raw:TITLE": "x"})
    assert _fields(p)["title"] == "T"


def test_unknown_canonical_field_is_refused(tmp_path):
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"])
    with pytest.raises(writers.WriteError, match="[Cc]opyright"):
        writers.edit_with_mutagen(p, {"copyright": "x"})


def test_clear_of_an_absent_tag_is_a_noop(tmp_path):
    p = _audio(tmp_path / "a.flac", ["-c:a", "flac"], "title=T")
    writers.edit_with_mutagen(p, {"synopsis": None, "raw:NOPE": None})
    assert _fields(p) == {"title": "T"}


def test_value_with_newline_and_unicode_roundtrips(tmp_path):
    p = _audio(tmp_path / "a.mp3", ["-c:a", "libmp3lame"])
    text = "line one\nline two \U0001f600 Füße & <b>"
    writers.edit_with_mutagen(p, {"description": text, "comment": text})
    f = _fields(p)
    assert f["description"] == text and f["comment"] == text
