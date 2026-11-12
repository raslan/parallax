from app.services import translate_text as tt


def test_markup_is_removed_and_lines_joined():
    p = tt.prepare("<i>Hello</i>\n{\\an8}there.")
    assert p.core == "Hello there."


def test_music_markers_are_kept_aside_and_put_back():
    p = tt.prepare("♪♪ Shoot to thrill ♪♪")
    assert (p.pre, p.core, p.post) == ("♪♪ ", "Shoot to thrill", " ♪♪")
    assert tt.restore(p, "translated", rtl=False) == "♪♪ translated ♪♪"


def test_hash_and_star_song_markers_count_too():
    p = tt.prepare("# la la la #")
    assert p.core == "la la la" and p.pre == "# " and p.post == " #"


def test_a_music_only_cue_stays_a_music_cue():
    p = tt.prepare("♪♪")
    assert p.core == ""
    assert tt.restore(p, "", rtl=False) == "♪♪"


def test_hearing_impaired_notes_and_speaker_labels_are_kept_by_default():
    assert tt.prepare("[DISTANT EXPLOSION]").core == "[DISTANT EXPLOSION]"
    assert tt.prepare("FURY: Get down!").core == "FURY: Get down!"


def test_they_can_be_dropped_on_request():
    assert tt.prepare("[DISTANT EXPLOSION] Run!", drop_hi=True).core == "Run!"
    assert tt.prepare("(MUSIC PLAYING)", drop_hi=True).core == ""
    assert tt.prepare("FURY: Get down!", drop_hi=True).core == "Get down!"
    # ordinary words in brackets or before a colon are speech, not notes
    assert tt.prepare("He said (quietly) hi.", drop_hi=True).core == "He said (quietly) hi."
    assert tt.prepare("Note: this is fine.", drop_hi=True).core == "Note: this is fine."


def test_rtl_mark_goes_in_front_of_everything():
    p = tt.prepare("♪ la ♪")
    out = tt.restore(p, "ل", rtl=True)
    assert out == "‫♪ ل ♪"


def test_empty_translation_of_a_spoken_cue_is_empty():
    assert tt.restore(tt.prepare("Hi"), "  ", rtl=False) == ""


def test_fold_unknown_replaces_look_alikes_and_drops_the_rest():
    known = set("Konigstrasse abc.")

    def is_unknown(s: str) -> bool:
        return any(c not in known for c in s)

    assert tt.fold_unknown("Königstrasse", is_unknown) == "Konigstrasse"
    assert tt.fold_unknown("abc ☃", is_unknown) == "abc "
    assert tt.fold_unknown("abc", is_unknown) == "abc"  # nothing unknown: untouched
    assert tt.fold_unknown("^.^.abc", is_unknown) == "..abc"  # unknown ASCII has no look-alike


def test_an_unknown_token_marker_never_reaches_the_subtitle():
    p = tt.prepare("4 X 400")
    assert tt.restore(p, "في 4 ⁇ 400 اليوم", rtl=False) == "في 4 400 اليوم"
    assert tt.restore(tt.prepare("x"), "⁇", rtl=False) == ""
