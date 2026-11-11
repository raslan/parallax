"""apply_one: the only function the route calls. Plan, write on a temp copy, verify, replace.

Fixtures are built per test with ffmpeg and Pillow; a test skips when the tool is missing.
"""

import logging
import os
import shutil
import subprocess
import threading
import time

import mutagen
import pytest
from PIL import Image

from app.services import organize_tag_write as apply
from app.services import organize_tag_writers as writers
from app.services import organize_tags

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
)
needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="exiftool missing")
needs_mkv = pytest.mark.skipif(shutil.which("mkvpropedit") is None, reason="mkvtoolnix missing")


def _audio(path, *meta, args=()):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1", *args]
    for kv in meta:
        cmd += ["-metadata", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return str(path)


def _mkv(path, *meta):
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1",
        "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10", "-c:v", "mpeg4",
    ]  # fmt: skip
    for kv in meta:
        cmd += ["-metadata", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return str(path)


def _image(path):
    Image.new("RGB", (16, 16), "red").save(path)
    return str(path)


def _fields(path):
    return organize_tags.read_tags(path, full=True)["fields"]


def _hidden_leftovers(folder):
    return [n for n in os.listdir(folder) if n.startswith(".parallax-tags")]


@needs_ffmpeg
def test_apply_rewrite_replaces_file_and_keeps_mtime_and_mode(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=Old", "artist=Art")
    os.chmod(p, 0o640)
    os.utime(p, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
    before = os.stat(p)
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "written" and out.message == ""
    after = os.stat(p)
    assert after.st_mtime_ns == before.st_mtime_ns and after.st_mode == before.st_mode
    assert _fields(p) == {"title": "New", "artist": "Art"}
    assert sorted(os.listdir(tmp_path)) == ["a.mp3"]


@needs_ffmpeg
def test_apply_verify_failure_leaves_original_untouched(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    original = open(p, "rb").read()
    monkeypatch.setattr(writers, "edit_with_mutagen", lambda path, changes: None)  # silently skips
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "Title" in out.message
    assert open(p, "rb").read() == original
    assert _hidden_leftovers(tmp_path) == []


@needs_ffmpeg
def test_apply_refuses_when_free_space_short(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    original = open(p, "rb").read()
    usage = shutil.disk_usage(tmp_path)
    monkeypatch.setattr(
        apply.shutil, "disk_usage", lambda _p: type(usage)(usage.total, usage.total, 100)
    )
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "space" in out.message.lower()
    assert open(p, "rb").read() == original


@needs_ffmpeg
def test_apply_refuses_hard_linked_rewrite(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    os.link(p, tmp_path / "b.mp3")
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "hard link" in out.message.lower()
    assert _fields(str(tmp_path / "b.mp3"))["title"] == "Old"


@needs_ffmpeg
def test_apply_verify_checks_stream_count(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    real = apply._read_for_verify

    def one_stream_too_many(path, family):
        info = real(path, family)
        info["streams"] = [*info["streams"], "video extra"]
        return info

    calls = {"n": 0}

    def only_after(path, family):
        calls["n"] += 1
        return real(path, family) if calls["n"] == 1 else one_stream_too_many(path, family)

    monkeypatch.setattr(apply, "_read_for_verify", only_after)
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "stream" in out.message.lower()
    assert _fields(p)["title"] == "Old"


@needs_ffmpeg
def test_apply_verify_duration_tolerance(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    seq = iter([10.0, 10.05])  # before, after: a few hundredths is fine
    monkeypatch.setattr(apply, "_duration", lambda path: next(seq))
    assert apply.apply_one(p, {"title": "A"}).status == "written"
    seq = iter([10.0, 15.0])
    monkeypatch.setattr(apply, "_duration", lambda path: next(seq))
    out = apply.apply_one(p, {"title": "B"})
    assert out.status == "failed" and "duration" in out.message.lower()
    assert _fields(p)["title"] == "A"


@needs_ffmpeg
def test_apply_clear_verifies_field_gone(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=Old", "comment=c")
    out = apply.apply_one(p, {"comment": None})
    assert out.status == "written"
    assert _fields(p) == {"title": "Old"}


@needs_ffmpeg
def test_apply_value_with_control_characters_is_refused(tmp_path):
    """A NUL splits an ID3 text frame into several values and an XML tag can't hold it."""
    p = _audio(tmp_path / "a.mp3", "title=Old")
    original = open(p, "rb").read()
    for bad in ("a\x00b", "a\x07b", "a\x1bb"):
        out = apply.apply_one(p, {"title": bad})
        assert out.status == "failed" and "characters" in out.message
    ok = apply.apply_one(p, {"description": "line one\nline two\ttabbed"})
    assert ok.status == "written"
    assert open(p, "rb").read() != original  # the allowed one did write


@needs_ffmpeg
def test_apply_blank_value_clears(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=Old", "artist=A")
    assert apply.apply_one(p, {"artist": "   "}).status == "written"
    assert _fields(p) == {"title": "Old"}


@needs_exiftool
def test_apply_unknown_field_fails_that_file_only(tmp_path):
    p = _image(tmp_path / "a.jpg")
    out = apply.apply_one(p, {"synopsis": "x"})
    assert out.status == "failed" and "Synopsis" in out.message
    assert _hidden_leftovers(tmp_path) == []


@needs_ffmpeg
def test_apply_temp_is_hidden_and_in_the_same_folder(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    seen = []
    real = writers.edit_with_mutagen

    def spy(path, changes):
        seen.append((os.path.dirname(path), os.path.basename(path), sorted(os.listdir(tmp_path))))
        return real(path, changes)

    monkeypatch.setattr(writers, "edit_with_mutagen", spy)
    assert apply.apply_one(p, {"title": "New"}).status == "written"
    folder, name, listing = seen[0]
    assert folder == str(tmp_path) and name.startswith(".") and name.endswith(".mp3")
    assert [n for n in listing if not n.startswith(".")] == ["a.mp3"]


def test_apply_path_that_vanished_is_failed_not_raised(tmp_path):
    out = apply.apply_one(str(tmp_path / "gone.mp3"), {"title": "x"})
    assert out.status == "failed" and out.message


def test_apply_read_only_format_reports_the_plans_reason(tmp_path):
    p = tmp_path / "a.rmvb"
    p.write_bytes(b"\0" * 32)
    out = apply.apply_one(str(p), {"title": "x"})
    assert out.status == "failed" and "this format" in out.message


@needs_ffmpeg
def test_apply_logs_no_tag_text(tmp_path, caplog):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    secret = "SECRET-VALUE-123"
    with caplog.at_level(logging.DEBUG):
        apply.apply_one(p, {"title": secret})
        apply.apply_one(p, {"synopsis": None, "copyright": secret})  # a failure path too
    assert secret not in caplog.text


@needs_ffmpeg
@needs_mkv
def test_apply_in_place_failure_triggers_restore(tmp_path, monkeypatch):
    p = _mkv(tmp_path / "a.mkv", "title=Seg", "artist=A")
    restored = []
    real = writers.restore_mkv

    def spy(path, snap):
        restored.append(path)
        return real(path, snap)

    monkeypatch.setattr(writers, "restore_mkv", spy)
    real_read = apply._read_for_verify
    state = {"n": 0}

    def lie_after_write(path, family):
        state["n"] += 1
        info = real_read(path, family)
        if state["n"] > 1:  # the post-write read: pretend the title did not stick
            info["fields"] = {**info["fields"], "title": "wrong"}
        return info

    monkeypatch.setattr(apply, "_read_for_verify", lie_after_write)
    out = apply.apply_one(p, {"artist": "Z", "title": "New"})
    assert out.status == "failed" and "restored" in out.message
    assert restored == [p]
    f = _fields(p)
    assert f["artist"] == "A" and f["title"] == "Seg"


@needs_ffmpeg
@needs_mkv
@needs_exiftool
def test_apply_dispatches_by_extension(tmp_path, monkeypatch):
    calls = []
    for name in ("write_mkv", "edit_with_mutagen", "edit_with_ffmpeg", "write_image"):
        real = getattr(writers, name)

        def spy(*a, _n=name, _r=real, **k):
            calls.append(_n)
            return _r(*a, **k)

        monkeypatch.setattr(writers, name, spy)
    files = {
        "write_mkv": _mkv(tmp_path / "a.mkv", "title=T"),
        "edit_with_mutagen": _audio(tmp_path / "a.mp3", "title=T"),
        "write_image": _image(tmp_path / "a.jpg"),
    }
    for expected, path in files.items():
        calls.clear()
        out = apply.apply_one(path, {"title": "N"})
        assert out.status == "written", (path, out.message)
        assert calls == [expected], (path, calls)
    flv = str(tmp_path / "a.flv")
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1",
            "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10",
            "-c:v", "flv1", "-c:a", "mp3", "-ar", "44100", flv,
        ],
        check=True,
    )  # fmt: skip
    calls.clear()
    assert apply.apply_one(flv, {"title": "N"}).status == "written"
    assert calls == ["edit_with_ffmpeg"]


@needs_ffmpeg
def test_apply_stale_temp_from_a_previous_run_does_not_break_it(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    stale = tmp_path / ".parallax-tags-1-1.mp3"
    stale.write_bytes(b"junk from a killed server")
    assert apply.apply_one(p, {"title": "New"}).status == "written"
    assert stale.read_bytes() == b"junk from a killed server"
    assert _fields(p)["title"] == "New"


@needs_ffmpeg
def test_apply_sweeps_old_stale_temps_but_leaves_young_ones(tmp_path):
    """A killed server leaves a full-size hidden temp; an hours-old one is removed, but a
    young one may belong to another edit still running in the folder."""
    import time

    p = _audio(tmp_path / "a.mp3", "title=Old")
    old = tmp_path / ".parallax-tags-1-1.mp3"
    old.write_bytes(b"x" * 10)
    gone = time.time() - 7 * 3600
    os.utime(old, (gone, gone))
    young = tmp_path / ".parallax-tags-2-2.mp3"
    young.write_bytes(b"y" * 10)
    unrelated = tmp_path / ".hidden-other.mp3"
    unrelated.write_bytes(b"z")
    os.utime(unrelated, (gone, gone))
    assert apply.apply_one(p, {"title": "New"}).status == "written"
    assert not old.exists()
    assert young.exists() and unrelated.exists()


@needs_ffmpeg
def test_apply_fails_when_the_file_was_replaced_while_it_was_being_edited(tmp_path, monkeypatch):
    """A Compress/Toolbox job swapping the file mid-edit must not be overwritten by an edited
    copy of the old bytes."""
    p = _audio(tmp_path / "a.mp3", "title=Old")
    real = writers.edit_with_mutagen

    def swap_then_edit(path, changes):
        real(path, changes)
        newer = tmp_path / "other.mp3"
        _audio(newer, "title=Replacement", args=["-b:a", "64k"])
        os.replace(newer, p)  # another job's output lands on the original

    monkeypatch.setattr(writers, "edit_with_mutagen", swap_then_edit)
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "changed while" in out.message
    assert _fields(p)["title"] == "Replacement"
    assert _hidden_leftovers(tmp_path) == []


@needs_ffmpeg
def test_apply_collateral_new_field_appearing_fails(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old")
    original = open(p, "rb").read()
    real = writers.edit_with_mutagen

    def adds_an_artist(path, changes):
        real(path, changes)
        real(path, {"artist": "Appeared"})

    monkeypatch.setattr(writers, "edit_with_mutagen", adds_an_artist)
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "Artist" in out.message
    assert open(p, "rb").read() == original


@needs_ffmpeg
def test_apply_collateral_change_to_another_field_fails(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=Old", "artist=Keep")
    original = open(p, "rb").read()
    real = writers.edit_with_mutagen

    def edits_too_much(path, changes):
        real(path, changes)
        real(path, {"artist": "Clobbered"})

    monkeypatch.setattr(writers, "edit_with_mutagen", edits_too_much)
    out = apply.apply_one(p, {"title": "New"})
    assert out.status == "failed" and "Artist" in out.message
    assert open(p, "rb").read() == original


@needs_ffmpeg
def test_apply_raw_tag_add_and_clear_verify(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=T")
    assert apply.apply_one(p, {"raw:MOOD": "calm"}).status == "written"
    assert organize_tags.read_tags(p, full=True)["raw"]["MOOD"] == "calm"
    assert apply.apply_one(p, {"raw:MOOD": None}).status == "written"
    assert "MOOD" not in organize_tags.read_tags(p, full=True)["raw"]


@needs_ffmpeg
def test_apply_refuses_unsafe_raw_names(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=T")
    out = apply.apply_one(p, {"raw:TITLE": "x"})
    assert out.status == "failed" and "Title" in out.message
    assert _fields(p) == {"title": "T"}


@needs_ffmpeg
def test_apply_track_and_mp4_numbers_verify(tmp_path):
    p = _audio(tmp_path / "a.m4a", "title=T", args=["-c:a", "aac"])
    assert apply.apply_one(p, {"track": "3"}).status == "written"
    assert apply.apply_one(p, {"track": "3/12"}).status == "written"
    assert _fields(p)["track"].split("/")[0] == "3"


@needs_exiftool
def test_apply_image_date_keywords_and_gps_verify(tmp_path):
    p = _image(tmp_path / "a.jpg")
    subprocess.run(
        ["exiftool", "-q", "-overwrite_original", "-GPSLatitude=1", "-GPSLatitudeRef=N", p],
        check=True,
    )
    out = apply.apply_one(p, {"date": "2020-05-01", "keywords": "a, b", "gps": None})
    assert out.status == "written", out.message
    f = _fields(p)
    assert f["date"] == "2020:05:01 00:00:00" and f["keywords"] == "a, b"
    raw = organize_tags.read_tags(p, full=True)["raw"]
    assert not [k for k in raw if k.startswith("GPS:")]


@needs_exiftool
def test_apply_image_keeps_mtime_and_leaves_no_temp(tmp_path):
    p = _image(tmp_path / "a.png")
    os.utime(p, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
    assert apply.apply_one(p, {"title": "T"}).status == "written"
    assert os.stat(p).st_mtime_ns == 1_600_000_000_000_000_000
    assert sorted(os.listdir(tmp_path)) == ["a.png"]


@needs_ffmpeg
def test_apply_mkv_keeps_mtime(tmp_path):
    if shutil.which("mkvpropedit") is None:
        pytest.skip("mkvtoolnix missing")
    p = _mkv(tmp_path / "a.mkv", "artist=A")
    os.utime(p, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
    assert apply.apply_one(p, {"artist": "B"}).status == "written"
    assert os.stat(p).st_mtime_ns == 1_600_000_000_000_000_000


@needs_ffmpeg
def test_apply_same_file_twice_at_once_is_serialised(tmp_path):
    p = _audio(tmp_path / "a.mp3", "title=T")
    results = []

    def run(changes):
        results.append(apply.apply_one(p, changes))

    threads = [
        threading.Thread(target=run, args=({"artist": "A"},)),
        threading.Thread(target=run, args=({"album": "B"},)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert [r.status for r in results] == ["written", "written"]
    assert _fields(p) == {"title": "T", "artist": "A", "album": "B"}


@needs_ffmpeg
def test_apply_leaves_no_lock_behind_once_a_file_is_done(tmp_path):
    """The per-path lock exists only while an edit of that path runs or waits."""
    p = _audio(tmp_path / "a.mp3", "title=T")
    assert apply.apply_one(p, {"artist": "A"}).status == "written"
    assert apply.apply_one(str(tmp_path / "gone.mp3"), {"artist": "A"}).status == "failed"
    assert apply._locks == {}


@needs_ffmpeg
def test_apply_keeps_the_lock_while_another_request_waits_for_it(tmp_path, monkeypatch):
    p = _audio(tmp_path / "a.mp3", "title=T")
    inside, release = threading.Event(), threading.Event()
    real = writers.edit_with_mutagen

    def slow(path, changes):
        inside.set()
        release.wait(5)
        return real(path, changes)

    monkeypatch.setattr(writers, "edit_with_mutagen", slow)
    results = []
    first = threading.Thread(target=lambda: results.append(apply.apply_one(p, {"artist": "A"})))
    second = threading.Thread(target=lambda: results.append(apply.apply_one(p, {"album": "B"})))
    first.start()
    assert inside.wait(5)
    second.start()
    time.sleep(0.2)  # the second request is now waiting on the first one's lock
    assert len(apply._locks) == 1
    release.set()
    first.join()
    second.join()
    assert [r.status for r in results] == ["written", "written"]
    assert _fields(p) == {"title": "T", "artist": "A", "album": "B"}
    assert apply._locks == {}


@needs_ffmpeg
def test_apply_keeps_cover_art_and_other_frames(tmp_path):
    from mutagen.id3 import APIC, ID3

    p = _audio(tmp_path / "a.mp3", "title=T")
    tags = ID3(p)
    tags.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=b"\x89PNG-fake"))
    tags.save(p)
    assert apply.apply_one(p, {"title": "New"}).status == "written"
    assert mutagen.File(p).tags.getall("APIC")[0].data == b"\x89PNG-fake"
