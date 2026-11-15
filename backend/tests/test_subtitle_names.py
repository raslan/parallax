import os

import pytest

from app.services import subtitle_names as sn
from app.services import subtitle_service as ss


def test_parse_language_only():
    tag = sn.parse_tag("en")
    assert tag == sn.SubTag("en", False, None, False, None)
    assert sn.is_real(tag) and tag.kind == "real"
    assert sn.parse_tag("") == sn.SubTag("und", False, None, False, None)


def test_parse_hi_and_label():
    tag = sn.parse_tag("ar.hi.subf2m")
    assert tag.hearing_impaired and tag.label == "subf2m" and tag.kind == "hearing_impaired"
    assert sn.is_real(tag)
    assert sn.parse_tag("AR.HI").hearing_impaired


def test_generated_and_suffixes():
    for s in ("en.generated", "en.generated-2", "en.GENERATED-turbo"):
        tag = sn.parse_tag(s)
        assert tag.machine_kind == "generated" and tag.machine_made and tag.kind == "generated"
        assert tag.label is None and not sn.is_real(tag)


def test_translated():
    for s in ("ar.translated", "ar.translated-2"):
        tag = sn.parse_tag(s)
        assert tag.machine_kind == "translated" and tag.kind == "translated"
        assert not sn.is_real(tag)


def test_original_excluded():
    tag = sn.parse_tag("en.original")
    assert tag.original and not sn.is_real(tag) and tag.kind == "original"


def test_machine_and_mt_are_labels_now():
    for word in ("machine", "mt"):
        tag = sn.parse_tag(f"en.{word}")
        assert not tag.machine_made and tag.label == word and sn.is_real(tag)


def test_original_after_label():
    tag = sn.parse_tag("en.subf2m.original")
    assert tag.original and tag.label == "subf2m"


def test_subtitle_path():
    assert sn.subtitle_path("/a/Movie.mkv", "en") == "/a/Movie.en.srt"
    assert (
        sn.subtitle_path("/a/Movie.mkv", "ar", hearing_impaired=True, token="subf2m")
        == "/a/Movie.ar.hi.subf2m.srt"
    )


def test_variant_path_keep_dedupes(tmp_path):
    video = str(tmp_path / "Movie.mkv")
    plain = sn.variant_path(video, "en", "generated", keep=True)
    assert plain.endswith("Movie.en.generated.srt")
    (tmp_path / "Movie.en.generated.srt").write_text("x")
    assert sn.variant_path(video, "en", "generated", keep=True).endswith("Movie.en.generated-2.srt")
    (tmp_path / "Movie.en.generated-2.srt").write_text("x")
    assert sn.variant_path(video, "en", "generated", keep=True).endswith("Movie.en.generated-3.srt")
    assert sn.variant_path(video, "en", "generated", keep=False).endswith("Movie.en.generated.srt")


def test_variant_path_probes_the_final_extension(tmp_path):
    video = str(tmp_path / "Movie.mkv")
    (tmp_path / "Movie.en.subf2m.ass").write_text("x")
    # a free `.srt` name must not hide a taken `.ass` one
    assert sn.variant_path(video, "en", "subf2m", keep=True, ext=".ass").endswith(
        "Movie.en.subf2m-2.ass"
    )
    assert sn.variant_path(video, "en", "subf2m", keep=True).endswith("Movie.en.subf2m.srt")
    assert sn.variant_path(video, "en", "subf2m", keep=False, ext=".ass").endswith(
        "Movie.en.subf2m.ass"
    )


def test_original_path():
    assert sn.original_path("Movie.en.srt") == "Movie.en.original.srt"
    assert sn.original_path("Movie.en.subf2m.srt") == "Movie.en.subf2m.original.srt"


@pytest.fixture
def folder(tmp_path):
    v = tmp_path / "Movie.mkv"
    v.write_bytes(b"v")
    return v


def touch(folder, *names):
    for n in names:
        (folder.parent / n).write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n\n")


def test_stem_match_is_exact(folder):
    touch(folder, "Movie 2.en.srt", "Movie.fr.srt")
    found = [os.path.basename(p) for p, _ in ss._tagged_files(str(folder))]
    assert found == ["Movie.fr.srt"]


def test_missing_counts_only_real(folder):
    touch(folder, "Movie.en.generated.srt", "Movie.en.original.srt")
    assert ss._missing_lang_codes(str(folder), ["en"]) == ["en"]
    touch(folder, "Movie.en.hi.srt")
    assert ss._missing_lang_codes(str(folder), ["en"]) == []
    (folder.parent / "Movie.en.hi.srt").unlink()
    touch(folder, "Movie.en.subf2m.srt")
    assert ss._missing_lang_codes(str(folder), ["en"]) == []


def test_tracks_skip_originals_and_carry_kind_and_labels(folder):
    touch(
        folder,
        "Movie.en.srt",
        "Movie.en.original.srt",
        "Movie.ar.hi.srt",
        "Movie.ar.generated.srt",
        "Movie.fr.translated-2.srt",
        "Movie.de.yts.srt",
    )
    tracks = {os.path.basename(t["path"]): t for t in ss.find_all_subtitle_tracks(str(folder))}
    assert "Movie.en.original.srt" not in tracks
    assert tracks["Movie.en.srt"]["label"] == "English" and tracks["Movie.en.srt"]["kind"] == "real"
    hi = tracks["Movie.ar.hi.srt"]
    assert hi["label"] == "Arabic (hearing impaired)" and hi["kind"] == "hearing_impaired"
    gen = tracks["Movie.ar.generated.srt"]
    assert (
        gen["label"] == "Arabic (generated)" and gen["machine_made"] and gen["kind"] == "generated"
    )
    assert tracks["Movie.fr.translated-2.srt"]["label"] == "French (translated)"
    assert tracks["Movie.de.yts.srt"]["label"] == "German (yts)"


def test_scan_reports_machine_languages(folder):
    touch(folder, "Movie.en.srt", "Movie.ar.translated.srt")
    (row,) = ss.scan_directory(str(folder.parent), ["en", "ar"])
    assert row["languages"] == {"en": True, "ar": False}
    assert row["machine_languages"] == {"en": False, "ar": True}


def test_delete_removes_the_real_or_the_machine_made_files_only(folder):
    touch(folder, "Movie.ar.srt", "Movie.ar.generated.srt", "Movie.ar.translated.srt")
    assert ss.delete_subtitle(str(folder), "ar", machine=True) is True
    assert sorted(os.listdir(folder.parent)) == ["Movie.ar.srt", "Movie.mkv"]
    assert ss.delete_subtitle(str(folder), "ar", machine=True) is False
    assert ss.delete_subtitle(str(folder), "ar") is True


def test_remove_machine_made_removes_both_kinds(folder):
    touch(folder, "Movie.ar.generated.srt", "Movie.ar.translated.srt", "Movie.en.generated.srt")
    assert ss.remove_machine_made(str(folder), "ar") is True
    assert sorted(os.listdir(folder.parent)) == ["Movie.en.generated.srt", "Movie.mkv"]
    assert ss.remove_machine_made(str(folder), "ar") is False
