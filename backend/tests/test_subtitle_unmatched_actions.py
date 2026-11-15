"""Preview, rename and delete of subtitle files that no video claims (folder-scoped).

The folder is the only thing the client names; whether a path is one of its unmatched
subtitles is derived on the server from a fresh walk, never from what the client says."""

import json
import os

import pytest

from app.services import subtitle_files as sf
from app.services import subtitle_preview as sp


def write(path, text="1\n00:00:01,000 --> 00:00:03,000\nHello\n\n"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return str(path)


@pytest.fixture
def tree(tmp_path, monkeypatch):
    monkeypatch.setattr(sp, "PREVIEW_DIR", str(tmp_path / "previews"))
    root = tmp_path / "lib"
    write(root / "Show" / "Show.mkv", "v")
    owned = write(root / "Show" / "Show.en.srt")
    stray = write(root / "Show" / "Subs" / "2_English.srt")
    other = write(root / "Show" / "Subs" / "3_Arabic.srt")
    return str(root), owned, stray, other


def post(client, route, body):
    return client.post(f"/api/subtitles/unmatched/{route}", json=body)


def test_preview_returns_lines_and_serves_vtt(client, tree, monkeypatch):
    root, _, stray, _ = tree
    before = sorted(os.listdir(os.path.dirname(stray)))
    r = post(client, "preview", {"root": root, "subtitle_path": stray})
    assert r.status_code == 200
    body = r.json()
    assert body["cues"] == 1 and body["lines"][0]["text"] == "Hello"
    v = client.get(f"/api/subtitles/preview/{body['preview_id']}.vtt")
    assert v.status_code == 200 and v.text.startswith("WEBVTT")
    assert sorted(os.listdir(os.path.dirname(stray))) == before


def test_preview_with_a_video_reports_its_length(client, tree, monkeypatch):
    root, _, stray, _ = tree
    monkeypatch.setattr("app.api.subtitle_run.probe_duration", lambda p: 100.0)
    video = os.path.join(root, "Show", "Show.mkv")
    r = post(client, "preview", {"root": root, "subtitle_path": stray, "video_path": video})
    assert r.json()["video_duration"] == 100.0


def _refused(client, tree, tmp_path, route, extra, path):
    root = tree[0]
    r = post(client, route, {"root": root, **extra(path)})
    assert r.status_code in (400, 404), (route, path, r.text)


PATH_ARG = {
    "preview": lambda p: {"subtitle_path": p},
    "rename": lambda p: {"subtitle_path": p, "new_name": "x.srt"},
    "delete": lambda p: {"subtitle_paths": [p]},
}


@pytest.mark.parametrize("route", ["preview", "rename", "delete"])
def test_refuses_paths_not_in_the_unmatched_listing(client, tree, tmp_path, route):
    root, owned, _, _ = tree
    outside = tmp_path / "outside.srt"
    write(outside)
    link = os.path.join(root, "Show", "Subs", "link.srt")
    os.symlink(str(outside), link)
    for bad in (
        owned,  # a subtitle a video owns
        "/etc/passwd",
        "../x",
        os.path.join(root, "Show", "Show.mkv"),  # a video
        link,  # a symlink pointing out of the root
        "a\0b.srt",
    ):
        _refused(client, tree, tmp_path, route, PATH_ARG[route], bad)
    assert outside.exists() and os.path.exists(owned)


@pytest.mark.parametrize("route", ["preview", "rename", "delete"])
def test_refuses_a_root_that_is_not_a_folder(client, tree, route):
    _, _, stray, _ = tree
    for bad_root in (stray, "/nope/nowhere", ""):
        r = post(client, route, {"root": bad_root, **PATH_ARG[route](stray)})
        assert r.status_code in (400, 404)
    assert os.path.exists(stray)


def test_rename_in_place_keeps_the_folder(client, tree):
    root, _, stray, _ = tree
    r = post(client, "rename", {"root": root, "subtitle_path": stray, "new_name": "Show.fr.srt"})
    assert r.status_code == 200
    new = os.path.join(os.path.dirname(stray), "Show.fr.srt")
    assert r.json() == {"path": new}
    assert os.path.exists(new) and not os.path.exists(stray)


def test_rename_refuses_taken_hidden_separator_and_extension_change(client, tree):
    root, _, stray, other = tree
    for bad in ("3_Arabic.srt", ".hid.srt", "a/b.srt", "a\\b.srt", "a\0b.srt", "", "x.ass"):
        r = post(client, "rename", {"root": root, "subtitle_path": stray, "new_name": bad})
        assert r.status_code == 400, bad
    assert os.path.exists(stray) and os.path.exists(other)
    assert open(other).read().startswith("1\n")  # nothing was overwritten


def test_delete_removes_exactly_the_listed_files(client, tree):
    root, owned, stray, other = tree
    r = post(client, "delete", {"root": root, "subtitle_paths": [stray, stray]})
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    assert not os.path.exists(stray) and os.path.exists(other) and os.path.exists(owned)
    # one bad path refuses the whole request: nothing is deleted
    r = post(client, "delete", {"root": root, "subtitle_paths": [other, owned]})
    assert r.status_code == 400 and os.path.exists(other)


def test_a_path_that_vanished_is_a_named_404(client, tree):
    root, _, stray, _ = tree
    os.remove(stray)
    for route in ("preview", "rename", "delete"):
        r = post(client, route, {"root": root, **PATH_ARG[route](stray)})
        assert r.status_code == 404 and r.json()["detail"], route


def test_each_action_walks_the_tree_once(tree, monkeypatch):
    root, _, stray, _ = tree
    calls = []
    real = os.walk
    monkeypatch.setattr(os, "walk", lambda *a, **k: (calls.append(a), real(*a, **k))[1])
    sf.rename_unmatched(root, stray, "y.srt")
    assert len(calls) == 1


def test_routes_are_plain_def():
    import inspect

    from app.api import subtitle_files, subtitle_run

    for fn in (
        subtitle_files.unmatched_rename,
        subtitle_files.unmatched_delete,
        subtitle_run.preview_unmatched,
    ):
        assert not inspect.iscoroutinefunction(fn)


def test_sync_file_accepts_the_folder_it_was_started_from(client, tmp_path, monkeypatch, engine):
    from sqlalchemy.orm import sessionmaker

    from app.models.job import Job

    video = write(tmp_path / "Show" / "Movie.mkv", "v")
    sub = write(tmp_path / "Show" / "Movie.en.srt")
    seen = []

    async def fake_enqueue(job_id, fn, *args):
        seen.append(args)

    monkeypatch.setattr("app.api.subtitles.enqueue", fake_enqueue)
    r = client.post(
        "/api/subtitles/sync-file",
        json={"file_path": video, "subtitle_path": sub, "path": str(tmp_path)},
    )
    assert r.status_code == 200
    db = sessionmaker(bind=engine)()
    try:
        assert json.loads(db.get(Job, r.json()["job_id"]).settings) == {"path": str(tmp_path)}
    finally:
        db.close()
    r = client.post(
        "/api/subtitles/sync-file",
        json={"file_path": video, "subtitle_path": sub, "path": "/no/such/folder"},
    )
    assert r.status_code == 400
