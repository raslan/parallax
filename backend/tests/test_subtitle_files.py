import os

import pytest

from app.services import subtitle_files as sf
from app.services.subtitle_files import SubtitleFileError

SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n"


def touch(path, text=SRT):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return str(path)


@pytest.fixture
def movie(tmp_path):
    video = touch(tmp_path / "Movie.mkv", "video")
    return str(tmp_path), video


def names(files):
    return sorted(f["name"] for f in files)


def test_list_includes_all_kinds(movie):
    root, video = movie
    for n in (
        "Movie.en.srt",
        "Movie.en.hi.srt",
        "Movie.en.subf2m.srt",
        "Movie.en.generated.srt",
        "Movie.ar.translated.srt",
        "Movie.en.original.srt",
    ):
        touch(os.path.join(root, n))
    touch(os.path.join(root, "Subs", "Movie.en.srt"))
    files = sf.list_subtitle_files(video)
    assert len(files) == 7
    by = {(f["directory"], f["name"]): f for f in files}
    assert by[("", "Movie.en.srt")]["kind"] == "real"
    assert by[("", "Movie.en.hi.srt")]["kind"] == "hearing_impaired"
    assert by[("", "Movie.en.subf2m.srt")]["label"] == "subf2m"
    assert by[("", "Movie.en.generated.srt")]["kind"] == "generated"
    assert by[("", "Movie.ar.translated.srt")]["language"] == "ar"
    assert by[("", "Movie.en.original.srt")]["kind"] == "original"
    sub = by[("Subs", "Movie.en.srt")]
    assert sub["path"] == os.path.join(root, "Subs", "Movie.en.srt")
    assert sub["size"] == len(SRT)


def test_exact_stem_not_prefix(movie):
    root, video = movie
    touch(os.path.join(root, "Movie 2.en.srt"))
    touch(os.path.join(root, "Movie.en.srt"))
    assert names(sf.list_subtitle_files(video)) == ["Movie.en.srt"]


def test_unmatched_lists_scene_names(tmp_path):
    touch(tmp_path / "Show" / "Show.mkv", "v")
    touch(tmp_path / "Show" / "Show.en.srt")
    touch(tmp_path / "Show" / "Subs" / "2_English.srt")
    touch(tmp_path / "Show" / "Subs" / "readme_notes.srt")
    out = sf.unmatched_subtitles(str(tmp_path))
    by = {o["name"]: o for o in out}
    assert set(by) == {"2_English.srt", "readme_notes.srt"}
    assert by["2_English.srt"]["language"] == "en"
    assert by["2_English.srt"]["directory"] == os.path.join("Show", "Subs")
    assert by["readme_notes.srt"]["language"] is None


def test_unmatched_walks_the_tree_once(tmp_path, monkeypatch):
    for i in range(50):
        touch(tmp_path / f"V{i}.mkv", "v")
        touch(tmp_path / f"V{i}.en.srt")
    touch(tmp_path / "stray.srt")
    calls = []
    real = os.walk

    def counting(*a, **k):
        calls.append(a)
        return real(*a, **k)

    monkeypatch.setattr(os, "walk", counting)
    out = sf.unmatched_subtitles(str(tmp_path))
    assert [o["name"] for o in out] == ["stray.srt"]
    assert len(calls) == 1


def test_rename_refuses_taken_hidden_separator_and_extension_change(movie):
    root, video = movie
    a = touch(os.path.join(root, "Movie.en.subf2m.srt"))
    touch(os.path.join(root, "Movie.en.srt"))
    for bad in ("Movie.en.srt", ".hidden.srt", "a/b.srt", "a\\b.srt", "a\0b.srt", "", "Movie.ass"):
        with pytest.raises(SubtitleFileError):
            sf.rename_subtitle(video, a, bad)
    assert os.path.exists(a)


def test_rename_reports_outside_view(movie):
    root, video = movie
    a = touch(os.path.join(root, "Movie.en.subf2m.srt"))
    r = sf.rename_subtitle(video, a, "Movie.en.better.srt")
    assert r == {"path": os.path.join(root, "Movie.en.better.srt"), "outside_view": False}
    assert os.path.exists(r["path"]) and not os.path.exists(a)
    r2 = sf.rename_subtitle(video, r["path"], "Other.en.srt")
    assert r2["outside_view"] is True


def test_make_main_swaps_names(movie):
    root, video = movie
    plain = touch(os.path.join(root, "Movie.en.srt"), "plain")
    lab = touch(os.path.join(root, "Movie.en.subf2m.srt"), "labelled")
    r = sf.make_main(video, lab)
    assert r == {"main": plain, "other": lab}
    assert open(plain).read() == "labelled"
    assert open(lab).read() == "plain"
    assert names(sf.list_subtitle_files(video)) == ["Movie.en.srt", "Movie.en.subf2m.srt"]


def test_make_main_without_plain_just_renames(movie):
    root, video = movie
    lab = touch(os.path.join(root, "Movie.en.yts.srt"), "x")
    r = sf.make_main(video, lab)
    assert r["main"] == os.path.join(root, "Movie.en.srt")
    assert os.path.exists(r["main"]) and not os.path.exists(lab)


def test_make_main_refuses_unlabelled_and_machine(movie):
    root, video = movie
    plain = touch(os.path.join(root, "Movie.en.srt"))
    gen = touch(os.path.join(root, "Movie.en.generated.srt"))
    for p in (plain, gen):
        with pytest.raises(SubtitleFileError):
            sf.make_main(video, p)


def test_make_main_swaps_and_rolls_back(movie, monkeypatch):
    root, video = movie
    plain = touch(os.path.join(root, "Movie.en.srt"), "plain")
    lab = touch(os.path.join(root, "Movie.en.subf2m.srt"), "labelled")
    real = os.replace
    n = {"i": 0}

    def flaky(a, b):
        n["i"] += 1
        if n["i"] == 2:
            raise OSError("disk says no")
        return real(a, b)

    monkeypatch.setattr(os, "replace", flaky)
    with pytest.raises(SubtitleFileError):
        sf.make_main(video, lab)
    monkeypatch.undo()
    assert open(plain).read() == "plain"
    assert open(lab).read() == "labelled"
    assert sorted(os.listdir(root)) == ["Movie.en.srt", "Movie.en.subf2m.srt", "Movie.mkv"]


def test_delete_removes_and_counts(movie):
    root, video = movie
    a = touch(os.path.join(root, "Movie.en.srt"))
    b = touch(os.path.join(root, "Movie.ar.srt"))
    assert sf.delete_subtitles(video, [a, b]) == 2
    assert not os.path.exists(a) and not os.path.exists(b)


def test_delete_refuses_foreign_path(tmp_path, movie):
    root, video = movie
    mine = touch(os.path.join(root, "Movie.en.srt"))
    other_video = touch(tmp_path / "Movie 2.mkv", "v")
    other_sub = touch(tmp_path / "Movie 2.en.srt")
    outside = tmp_path.parent / "px-outside.srt"
    outside.write_text(SRT)
    for bad in (other_sub, video, "../x", str(outside), "/etc/passwd", other_video):
        with pytest.raises(SubtitleFileError):
            sf.delete_subtitles(video, [mine, bad])
    assert all(os.path.exists(p) for p in (mine, other_sub, video, str(outside)))


def test_delete_refuses_symlink_escape(tmp_path, movie):
    root, video = movie
    target = tmp_path.parent / "px-target.txt"
    target.write_text("keep")
    os.symlink("..", os.path.join(root, "up"))
    # a path that reaches an unrelated file through a symlinked folder is not in the listing
    with pytest.raises(SubtitleFileError):
        sf.delete_subtitles(video, [os.path.join(root, "up", "px-target.txt")])
    assert target.exists()


def test_tidy_each_mode_counts(tmp_path):
    v1 = touch(tmp_path / "A.mkv", "v")
    v2 = touch(tmp_path / "B.mkv", "v")
    for n in (
        "A.en.srt",
        "A.en.subf2m.srt",
        "A.en.generated.srt",
        "A.ar.translated-2.srt",
        "A.en.original.srt",
        "B.fr.yts.srt",
        "B.en.generated.srt",
    ):
        touch(tmp_path / n)
    # B.fr.yts has no plain French file: it is the only French one, so it is not an extra
    assert sf.tidy([v1, v2], "extra_versions") == 1
    assert not os.path.exists(tmp_path / "A.en.subf2m.srt")
    assert os.path.exists(tmp_path / "B.fr.yts.srt")
    assert sf.tidy([v1, v2], "generated_translated") == 3
    assert sf.tidy([v1, v2], "originals") == 1
    assert sorted(os.listdir(tmp_path)) == ["A.en.srt", "A.mkv", "B.fr.yts.srt", "B.mkv"]
    with pytest.raises(SubtitleFileError):
        sf.tidy([v1], "everything")


def test_routes_map_errors(client, movie):
    root, video = movie
    a = touch(os.path.join(root, "Movie.en.subf2m.srt"))
    touch(os.path.join(root, "Movie.en.srt"))
    r = client.post(
        "/api/subtitles/rename",
        json={"video_path": video, "subtitle_path": a, "new_name": "Movie.en.srt"},
    )
    assert r.status_code == 400
    assert "already" in r.json()["detail"]
    r = client.post(
        "/api/subtitles/delete",
        json={"video_path": video, "subtitle_paths": [os.path.join(root, "nope.srt")]},
    )
    assert r.status_code == 404
    r = client.post(
        "/api/subtitles/delete", json={"video_path": video, "subtitle_paths": ["/etc/passwd"]}
    )
    assert r.status_code == 400
    r = client.post("/api/subtitles/files", json={"video_path": video})
    assert r.status_code == 200 and len(r.json()) == 2
    r = client.post(
        "/api/subtitles/rename",
        json={"video_path": video, "subtitle_path": a, "new_name": "Other.en.srt"},
    )
    assert r.json()["outside_view"] is True
    moved = r.json()["path"]
    r = client.post("/api/subtitles/unmatched", json={"path": root})
    assert r.status_code == 200
    r = client.post("/api/subtitles/tidy", json={"video_paths": [video], "what": "originals"})
    assert r.json() == {"deleted": 0}
    r = client.post("/api/subtitles/make-main", json={"video_path": video, "subtitle_path": moved})
    assert r.status_code == 400


def test_scan_directory_lists_subtitles(movie):
    from app.services.subtitle_service import scan_directory

    root, video = movie
    touch(os.path.join(root, "Movie.en.srt"))
    out = scan_directory(root, ["en"])
    assert [s["name"] for s in out[0]["subtitles"]] == ["Movie.en.srt"]
    assert out[0]["has_subtitle"] is True
