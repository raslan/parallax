import os

import pytest

from app.services import machine_subs as ms
from app.services import subtitle_service as ss


def test_parse_tag_reads_language_hearing_impaired_and_machine_made():
    assert ms.parse_tag("en") == ms.SubTag("en", False, False)
    assert ms.parse_tag("ar.hi") == ms.SubTag("ar", True, False)
    assert ms.parse_tag("ar.machine") == ms.SubTag("ar", False, True)
    assert ms.parse_tag("en.hi.machine") == ms.SubTag("en", True, True)
    assert ms.parse_tag("en.machine.hi") == ms.SubTag("en", True, True)  # order does not matter
    assert ms.parse_tag("AR.MACHINE") == ms.SubTag("ar", False, True)
    assert ms.parse_tag("") == ms.SubTag("und", False, False)


def test_the_marker_is_not_a_language_code_and_the_old_one_is_still_read():
    assert ms.MARKER == "machine" and len(ms.MARKER) > 3  # no ISO 639 code is that long
    assert ms.tag_text("ar", False, True) == "ar.machine"
    # files written before the rename carry `mt`: still machine-made, never written again
    assert ms.parse_tag("ar.mt") == ms.SubTag("ar", False, True)
    assert ms.parse_tag("en.hi.mt") == ms.SubTag("en", True, True)
    # a real Maltese subtitle is a language, not a flag
    assert ms.parse_tag("mt") == ms.SubTag("mt", False, False)


def test_name_round_trips():
    for lang, hi, mt in [
        ("en", False, False),
        ("ar", True, False),
        ("ar", False, True),
        ("en", True, True),
    ]:
        tag = ms.parse_tag(ms.tag_text(lang, hi, mt))
        assert (tag.lang, tag.hearing_impaired, tag.machine_made) == (lang, hi, mt)


@pytest.fixture
def folder(tmp_path):
    v = tmp_path / "Movie (2020).mkv"
    v.write_bytes(b"v")
    return v


def touch(folder, *names):
    for n in names:
        (folder.parent / n).write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n\n")


def test_tracks_carry_flags_and_say_so_in_the_label(folder):
    touch(folder, "Movie (2020).en.srt", "Movie (2020).ar.hi.srt", "Movie (2020).ar.mt.srt")
    tracks = {os.path.basename(t["path"]): t for t in ss.find_all_subtitle_tracks(str(folder))}
    assert tracks["Movie (2020).en.srt"]["label"] == "English"
    hi = tracks["Movie (2020).ar.hi.srt"]
    assert hi["lang"] == "ar" and hi["hearing_impaired"] and not hi["machine_made"]
    assert hi["label"] == "Arabic (hearing impaired)"
    mt = tracks["Movie (2020).ar.mt.srt"]
    assert mt["lang"] == "ar" and mt["machine_made"] and mt["label"] == "Arabic (machine-made)"


def test_a_machine_made_file_never_counts_as_the_real_subtitle(folder):
    touch(folder, "Movie (2020).ar.mt.srt", "Movie (2020).en.mt.srt")
    assert ss._missing_lang_codes(str(folder), ["ar", "en"]) == ["ar", "en"]


def test_a_real_subtitle_counts_even_with_the_hi_tag_or_in_a_subs_folder(folder):
    touch(folder, "Movie (2020).ar.hi.srt")
    (folder.parent / "Subs").mkdir()
    (folder.parent / "Subs" / "Movie (2020).fr.srt").write_text("x")
    assert ss._missing_lang_codes(str(folder), ["ar", "fr", "en"]) == ["en"]


def test_scan_reports_machine_made_languages_separately(folder):
    touch(folder, "Movie (2020).en.srt", "Movie (2020).ar.mt.srt")
    (row,) = ss.scan_directory(str(folder.parent), ["en", "ar"])
    assert row["languages"] == {"en": True, "ar": False}
    assert row["machine_languages"] == {"en": False, "ar": True}
    assert row["has_subtitle"] is False  # Arabic is still missing a real one


def test_delete_removes_the_real_or_the_machine_made_file_only(folder):
    touch(folder, "Movie (2020).ar.srt", "Movie (2020).ar.mt.srt")
    assert ss.delete_subtitle(str(folder), "ar", machine=True) is True
    assert sorted(os.listdir(folder.parent)) == ["Movie (2020).ar.srt", "Movie (2020).mkv"]
    assert ss.delete_subtitle(str(folder), "ar", machine=True) is False
    assert ss.delete_subtitle(str(folder), "ar") is True


def test_a_real_download_replaces_the_machine_made_subtitle(folder):
    touch(folder, "Movie (2020).ar.mt.srt", "Movie (2020).en.mt.srt")
    assert ss.remove_machine_made(str(folder), "ar") is True
    assert sorted(os.listdir(folder.parent)) == [
        "Movie (2020).en.mt.srt",
        "Movie (2020).mkv",
    ]
    assert ss.remove_machine_made(str(folder), "ar") is False
