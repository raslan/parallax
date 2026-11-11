"""POST /organize/tags/plan and /organize/tags/apply: sandboxed, per-file results, never an
all-or-nothing 500. Real files in a temp dir; only the tools the file needs are required."""

import shutil
import subprocess

import pytest
from PIL import Image
from sqlalchemy.orm import Session

from app.models.settings import Setting

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="ffmpeg missing"
)
needs_exiftool = pytest.mark.skipif(shutil.which("exiftool") is None, reason="exiftool missing")


@pytest.fixture(autouse=True)
def _clean_organize_root(engine):
    with Session(engine) as s:
        s.query(Setting).filter(Setting.key == "organize_root").delete()
        s.commit()
    yield


def _root(client, path):
    assert client.put("/api/organize/root", json={"path": str(path)}).status_code == 200


def _mp3(path, *meta):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1"]
    for kv in meta:
        cmd += ["-metadata", kv]
    subprocess.run([*cmd, str(path)], check=True)
    return str(path)


def _plan(client, paths):
    return client.post("/api/organize/tags/plan", json={"paths": paths})


def _apply(client, items):
    return client.post("/api/organize/tags/apply", json={"items": items})


@needs_ffmpeg
@needs_exiftool
def test_plan_route_returns_plans_and_free_bytes(client, tmp_path):
    mp3 = _mp3(tmp_path / "a.mp3", "title=T")
    jpg = tmp_path / "p.jpg"
    Image.new("RGB", (8, 8)).save(jpg)
    (tmp_path / "n.txt").write_text("x")
    _root(client, tmp_path)
    gone = str(tmp_path / "gone.mp3")
    r = _plan(client, [mp3, str(jpg), str(tmp_path / "n.txt"), gone])
    assert r.status_code == 200
    body = r.json()
    plans = body["plans"]
    assert plans[mp3]["writable"] and plans[mp3]["how"] == "rewrite"
    assert plans[mp3]["fields"][0] == "title" and plans[mp3]["can_add_raw"] is True
    assert plans[mp3]["bytes_needed"] > 0 and plans[mp3]["note"] is None
    assert plans[str(jpg)]["fields"][:2] == ["title", "description"]
    assert plans[str(tmp_path / "n.txt")]["writable"] is False
    assert plans[gone]["writable"] is False and plans[gone]["reason"]
    assert body["free_bytes"][str(tmp_path)] > 0


@needs_ffmpeg
def test_plan_route_reports_the_note_for_the_ffmpeg_tier(client, tmp_path):
    flv = tmp_path / "a.flv"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=1",
            "-f", "lavfi", "-i", "testsrc=d=1:s=64x64:r=10",
            "-c:v", "flv1", "-c:a", "mp3", "-ar", "44100", str(flv),
        ],
        check=True,
    )  # fmt: skip
    _root(client, tmp_path)
    plan = _plan(client, [str(flv)]).json()["plans"][str(flv)]
    assert plan["how"] == "rewrite" and "may not survive" in plan["note"]


def test_plan_route_over_50_paths_is_400_and_empty_is_fine(client, tmp_path):
    _root(client, tmp_path)
    assert _plan(client, [str(tmp_path / f"{i}.mp3") for i in range(51)]).status_code == 400
    assert _plan(client, []).status_code == 200


def test_plan_route_outside_root_403_hidden_400_without_root_409(client, tmp_path):
    root = tmp_path / "root"
    (root / ".h").mkdir(parents=True)
    (root / ".h" / "a.mp3").write_bytes(b"x")  # a hidden file that exists is refused
    (tmp_path / "o.mp3").write_bytes(b"x")
    assert _plan(client, [str(root / "a.mp3")]).status_code == 409
    _root(client, root)
    assert _plan(client, [str(tmp_path / "o.mp3")]).status_code == 403
    assert _plan(client, [str(root / ".h" / "a.mp3")]).status_code == 400
    assert _plan(client, ["\x00"]).status_code == 400


def test_apply_route_over_20_items_is_rejected(client, tmp_path):
    _root(client, tmp_path)
    items = [{"path": str(tmp_path / f"{i}.mp3"), "set": {"title": "x"}} for i in range(21)]
    assert _apply(client, items).status_code == 422


def test_apply_route_outside_root_is_403_and_hidden_is_400_and_nothing_is_written(client, tmp_path):
    root = tmp_path / "root"
    (root / ".h").mkdir(parents=True)
    (root / ".h" / "a.mp3").write_bytes(b"x")
    (tmp_path / "o.mp3").write_bytes(b"x")
    _root(client, root)
    good = _mp3(root / "a.mp3", "title=Old")
    before = open(good, "rb").read()
    outside = {"path": str(tmp_path / "o.mp3"), "set": {"title": "x"}}
    hidden = {"path": str(root / ".h" / "a.mp3"), "set": {"title": "x"}}
    ok = {"path": good, "set": {"title": "New"}}
    assert _apply(client, [ok, outside]).status_code == 403
    assert _apply(client, [ok, hidden]).status_code == 400
    assert open(good, "rb").read() == before  # a bad path rejects the whole request first


def test_apply_route_without_a_root_is_409(client, tmp_path):
    assert (
        _apply(client, [{"path": str(tmp_path / "a.mp3"), "set": {"title": "x"}}]).status_code
        == 409
    )


def test_apply_route_same_path_twice_is_400(client, tmp_path):
    _root(client, tmp_path)
    p = str(tmp_path / "a.mp3")
    assert (
        _apply(
            client, [{"path": p, "set": {"title": "a"}}, {"path": p, "set": {"title": "b"}}]
        ).status_code
        == 400
    )


@needs_ffmpeg
def test_apply_route_one_failure_does_not_stop_the_rest(client, tmp_path):
    _root(client, tmp_path)
    good = _mp3(tmp_path / "a.mp3", "title=Old")
    gone = str(tmp_path / "gone.mp3")
    r = _apply(
        client,
        [{"path": gone, "set": {"title": "x"}}, {"path": good, "set": {"title": "New"}}],
    )
    assert r.status_code == 200
    results = r.json()["results"]
    assert results[gone]["status"] == "failed" and results[gone]["message"]
    assert results[good] == {"status": "written", "message": ""}
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format_tags=title", "-of", "csv=p=0", good],
        capture_output=True,
        text=True,
    )
    assert out.stdout.strip() == "New"


def test_apply_route_rejects_unknown_field_names_and_huge_values(client, tmp_path):
    _root(client, tmp_path)
    p = str(tmp_path / "a.mp3")
    for bad_set in ({"favourite_colour": "x"}, {"raw:": "x"}, {"title": "x" * 30_001}):
        assert _apply(client, [{"path": p, "set": bad_set}]).status_code == 422, bad_set
    assert _apply(client, [{"path": p, "set": {"title": "x" * 30_000}}]).status_code == 200


@needs_ffmpeg
@needs_exiftool
def test_apply_route_refuses_unsafe_raw_names_per_item(client, tmp_path):
    _root(client, tmp_path)
    jpg = tmp_path / "a.jpg"
    Image.new("RGB", (8, 8)).save(jpg)
    mp3 = _mp3(tmp_path / "a.mp3", "title=T")
    r = _apply(
        client,
        [
            {"path": str(jpg), "set": {"raw:File:FileName": "renamed.jpg"}},
            {"path": mp3, "set": {"raw:TITLE": "x"}},
        ],
    )
    assert r.status_code == 200
    results = r.json()["results"]
    assert results[str(jpg)]["status"] == "failed"
    assert results[mp3]["status"] == "failed" and "Title" in results[mp3]["message"]
    assert (tmp_path / "a.jpg").exists()  # not renamed


@needs_ffmpeg
def test_apply_route_refreshes_libraries_only_for_written_files(client, tmp_path, monkeypatch):
    from app.services import organize_tag_sync

    seen = []
    monkeypatch.setattr(organize_tag_sync, "refresh_libraries", lambda paths: seen.append(paths))
    _root(client, tmp_path)
    good = _mp3(tmp_path / "a.mp3", "title=Old")
    gone = str(tmp_path / "gone.mp3")
    _apply(client, [{"path": good, "set": {"title": "N"}}, {"path": gone, "set": {"title": "x"}}])
    assert seen == [[good]]


@needs_ffmpeg
def test_apply_route_credits_no_stats(client, tmp_path, monkeypatch):
    from app.services import stats

    monkeypatch.setattr(stats, "record_removal", lambda *a: pytest.fail("credited"))
    _root(client, tmp_path)
    good = _mp3(tmp_path / "a.mp3", "title=Old")
    assert _apply(client, [{"path": good, "set": {"title": "N"}}]).status_code == 200


def test_apply_route_runs_in_the_threadpool():
    import inspect

    from app.api import organize

    assert not inspect.iscoroutinefunction(organize.plan_tags)
    assert not inspect.iscoroutinefunction(organize.apply_tags)


def test_new_routes_need_a_session(anon_client, tmp_path):
    assert anon_client.post("/api/organize/tags/plan", json={"paths": []}).status_code == 401
    assert anon_client.post("/api/organize/tags/apply", json={"items": []}).status_code == 401
