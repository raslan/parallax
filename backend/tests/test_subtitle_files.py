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


def test_non_video_path_is_refused_and_nothing_walked(tmp_path, monkeypatch):
    sub = touch(tmp_path / "x.en.srt")
    txt = touch(tmp_path / "x.txt", "t")
    walks = []
    real = os.walk
    monkeypatch.setattr(os, "walk", lambda *a, **k: walks.append(a) or real(*a, **k))
    calls = [
        lambda: sf.list_subtitle_files(txt),
        lambda: sf.rename_subtitle(txt, sub, "x.en.better.srt"),
        lambda: sf.make_main(txt, sub),
        lambda: sf.delete_subtitles(txt, [sub]),
        lambda: sf.tidy([txt], "originals"),
    ]
    for call in calls:
        with pytest.raises(SubtitleFileError):
            call()
    assert walks == []
    assert os.path.exists(sub)


def test_missing_video_is_404_and_nothing_walked(client, monkeypatch):
    walks = []
    real = os.walk
    monkeypatch.setattr(os, "walk", lambda *a, **k: walks.append(a) or real(*a, **k))
    with pytest.raises(sf.SubtitleNotFound):
        sf.list_subtitle_files("/nonexistent/x.mkv")
    r = client.post("/api/subtitles/files", json={"video_path": "/nonexistent/x.mkv"})
    assert r.status_code == 404
    assert walks == []


def test_nul_byte_video_path_is_refused(client):
    with pytest.raises(SubtitleFileError):
        sf.list_subtitle_files("/tmp/a\0b.mkv")
    r = client.post("/api/subtitles/files", json={"video_path": "/tmp/a\0b.mkv"})
    assert r.status_code == 400


def test_routes_refuse_non_video_path(client, tmp_path):
    sub = touch(tmp_path / "x.en.srt")
    txt = touch(tmp_path / "x.txt", "t")
    bodies = {
        "files": {"video_path": txt},
        "rename": {"video_path": txt, "subtitle_path": sub, "new_name": "x.en.b.srt"},
        "make-main": {"video_path": txt, "subtitle_path": sub},
        "delete": {"video_path": txt, "subtitle_paths": [sub]},
        "tidy": {"video_paths": [txt], "what": "originals"},
    }
    for route, body in bodies.items():
        assert client.post(f"/api/subtitles/{route}", json=body).status_code == 400, route
    assert os.path.exists(sub)


def test_scan_directory_subtitles_add_one_walk_per_folder(tmp_path, monkeypatch):
    from app.services.subtitle_service import scan_directory

    for i in range(50):
        touch(tmp_path / f"V{i}.mkv", "v")
        touch(tmp_path / f"V{i}.en.srt")
    walks = []
    real = os.walk
    monkeypatch.setattr(os, "walk", lambda *a, **k: walks.append(a) or real(*a, **k))

    real_list = sf.list_subtitle_files
    monkeypatch.setattr(sf, "list_subtitle_files", lambda *a, **k: [])
    scan_directory(str(tmp_path))
    baseline = len(walks)  # the older per-video helpers plus the scan's own walk
    walks.clear()
    monkeypatch.setattr(sf, "list_subtitle_files", real_list)
    out = scan_directory(str(tmp_path))
    assert len(out[0]["subtitles"]) == 1
    # one distinct folder, so the new `subtitles` listing may add at most one walk, not 50
    print("walks added by subtitles:", len(walks) - baseline)
    assert len(walks) - baseline <= 1


def test_listed_path_wins_over_realpath_collision(tmp_path):
    video = touch(tmp_path / "M.mkv", "v")
    a = touch(tmp_path / "M.en.srt")
    b = str(tmp_path / "M.en.yts.srt")
    os.symlink(a, b)
    assert sf.delete_subtitles(video, [b]) == 1
    assert os.path.exists(a) and not os.path.lexists(b)


def test_scan_directory_lists_subtitles(movie):
    from app.services.subtitle_service import scan_directory

    root, video = movie
    touch(os.path.join(root, "Movie.en.srt"))
    out = scan_directory(root)
    assert [s["name"] for s in out[0]["subtitles"]] == ["Movie.en.srt"]


# ---------------------------------------------------------------- bulk remove by language and kind


@pytest.fixture
def two_videos(tmp_path):
    a = touch(tmp_path / "A.mkv", "v")
    b = touch(tmp_path / "B.mkv", "v")
    for n in (
        "A.ar.srt",
        "A.ar.subf2m.srt",
        "A.ar.hi.srt",
        "A.ar.generated.srt",
        "A.ar.translated.srt",
        "A.ar.original.srt",
        "A.en.srt",
        "B.ar.srt",
        "B.ar.yts.srt",
        "B.en.generated.srt",
        "B.en.original.srt",
    ):
        touch(tmp_path / n)
    return tmp_path, a, b


def left(tmp_path):
    return sorted(n for n in os.listdir(tmp_path) if n.endswith(".srt"))


def test_count_by_kind_across_two_videos(two_videos):
    _, a, b = two_videos
    assert sf.count_by_kind([a, b]) == {
        "ar": {
            "real": 4,  # A: plain + labelled, B: plain + labelled
            "hearing_impaired": 1,
            "generated": 1,
            "translated": 1,
            "original": 1,
        },
        "en": {"real": 1, "generated": 1, "original": 1},
    }


def test_count_by_kind_counts_each_video_once_even_if_listed_twice(two_videos):
    _, a, _ = two_videos
    assert sf.count_by_kind([a, a])["en"] == {"real": 1}


def test_removing_real_arabic_takes_plain_and_labelled_real_files_only(two_videos):
    tmp, a, b = two_videos
    assert sf.remove_by_kind([a, b], [("ar", "real")]) == 4
    assert left(tmp) == [
        "A.ar.generated.srt",
        "A.ar.hi.srt",
        "A.ar.original.srt",
        "A.ar.translated.srt",
        "A.en.srt",
        "B.en.generated.srt",
        "B.en.original.srt",
    ]


def test_removing_hearing_impaired_arabic_takes_only_the_hi_file(two_videos):
    tmp, a, b = two_videos
    assert sf.remove_by_kind([a, b], [("ar", "hearing_impaired")]) == 1
    assert "A.ar.hi.srt" not in left(tmp) and "A.ar.srt" in left(tmp)


def test_removing_sync_backups_takes_only_the_originals_of_that_language(two_videos):
    tmp, a, b = two_videos
    assert sf.remove_by_kind([a, b], [("ar", "original")]) == 1
    assert "A.ar.original.srt" not in left(tmp)
    assert "B.en.original.srt" in left(tmp)  # another language


def test_several_choices_are_removed_together(two_videos):
    tmp, a, b = two_videos
    assert sf.remove_by_kind([a, b], [("ar", "generated"), ("en", "generated")]) == 2
    assert "A.ar.generated.srt" not in left(tmp) and "B.en.generated.srt" not in left(tmp)


def test_generated_and_translated_are_their_own_kinds(two_videos):
    tmp, a, b = two_videos
    assert sf.remove_by_kind([a, b], [("ar", "translated")]) == 1
    assert "A.ar.generated.srt" in left(tmp)


def test_nothing_chosen_removes_nothing(two_videos):
    tmp, a, b = two_videos
    before = left(tmp)
    assert sf.remove_by_kind([a, b], []) == 0
    assert left(tmp) == before


def test_only_the_listed_videos_own_files_are_touched(tmp_path):
    a = touch(tmp_path / "Movie.mkv", "v")
    touch(tmp_path / "Movie 2.mkv", "v")
    touch(tmp_path / "Movie.ar.srt")
    touch(tmp_path / "Movie 2.ar.srt")  # another video's file: the name rule keeps it out
    touch(tmp_path / "Other.ar.srt")  # no video at all
    assert sf.remove_by_kind([a], [("ar", "real")]) == 1
    assert left(tmp_path) == ["Movie 2.ar.srt", "Other.ar.srt"]


def test_a_file_that_vanished_since_the_listing_is_skipped_not_an_error(two_videos, monkeypatch):
    tmp, a, b = two_videos

    def gone(snap, refusal):
        raise sf.SubtitleNotFound("That subtitle file was not found.")

    monkeypatch.setattr(sf, "_revalidate", gone)
    assert sf.remove_by_kind([a], [("ar", "real")]) == 0
    assert "A.ar.srt" in left(tmp)


def test_a_non_video_path_is_refused_by_both_calls(tmp_path):
    txt = touch(tmp_path / "x.txt", "t")
    with pytest.raises(SubtitleFileError):
        sf.count_by_kind([txt])
    with pytest.raises(SubtitleFileError):
        sf.remove_by_kind([txt], [("en", "real")])


def test_a_missing_video_is_refused(tmp_path):
    with pytest.raises(sf.SubtitleNotFound):
        sf.count_by_kind([str(tmp_path / "Gone.mkv")])


def test_remove_routes(client, two_videos):
    tmp, a, b = two_videos
    r = client.post("/api/subtitles/remove-counts", json={"video_paths": [a, b]})
    assert r.status_code == 200 and r.json()["ar"]["real"] == 4
    r = client.post(
        "/api/subtitles/remove",
        json={"video_paths": [a, b], "items": [{"language": "ar", "kind": "real"}]},
    )
    assert r.status_code == 200 and r.json() == {"removed": 4}
    assert "A.ar.srt" not in left(tmp)


def test_remove_routes_refuse_a_bad_kind_a_non_video_and_too_many(client, two_videos):
    tmp, a, b = two_videos
    bad_kind = {"video_paths": [a], "items": [{"language": "ar", "kind": "everything"}]}
    assert client.post("/api/subtitles/remove", json=bad_kind).status_code == 422
    bad_lang = {"video_paths": [a], "items": [{"language": "../x", "kind": "real"}]}
    assert client.post("/api/subtitles/remove", json=bad_lang).status_code == 422
    txt = touch(tmp / "x.txt", "t")
    assert (
        client.post(
            "/api/subtitles/remove",
            json={"video_paths": [txt], "items": [{"language": "ar", "kind": "real"}]},
        ).status_code
        == 400
    )
    assert (
        client.post("/api/subtitles/remove-counts", json={"video_paths": [txt]}).status_code == 400
    )
    many = [a] * 501
    assert (
        client.post("/api/subtitles/remove-counts", json={"video_paths": many}).status_code == 422
    )
    assert (
        client.post(
            "/api/subtitles/remove",
            json={"video_paths": many, "items": [{"language": "ar", "kind": "real"}]},
        ).status_code
        == 422
    )
    assert "A.ar.srt" in left(tmp)  # nothing was removed by any of these


def test_remove_routes_need_a_signed_in_user(anon_client, two_videos):
    _, a, _ = two_videos
    assert (
        anon_client.post("/api/subtitles/remove-counts", json={"video_paths": [a]}).status_code
        == 401
    )
