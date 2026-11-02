import os
import time

import pytest

from app.services import prune_scan
from app.services.prune_scan import Counts


@pytest.fixture(autouse=True)
def _reset():
    prune_scan.invalidate()
    yield
    prune_scan.invalidate()


def scan(root):
    prune_scan.start_scan(str(root))
    for _ in range(200):
        if prune_scan.scan_state()["status"] != "running":
            break
        time.sleep(0.05)
    assert prune_scan.scan_state()["status"] == "done"


def make_tree(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"x" * 10)
    (tmp_path / "n.txt").write_bytes(b"x" * 5)
    sub = tmp_path / "sub"
    (sub / "deep").mkdir(parents=True)
    (sub / "v.mp4").write_bytes(b"x" * 100)
    (sub / "deep" / "s.mp3").write_bytes(b"x" * 1000)
    (sub / "deep" / "b.jpg").write_bytes(b"x" * 1)
    return tmp_path


def test_scan_counts_subtree_totals(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    node = prune_scan.get_node(root)
    assert node.direct == Counts(files=2, images=1, other=1, bytes=15)
    assert node.total == Counts(files=5, images=2, videos=1, audio=1, other=1, bytes=1116)
    sub = prune_scan.get_node(os.path.join(root, "sub"))
    assert sub.direct == Counts(files=1, videos=1, bytes=100)
    assert sub.total == Counts(files=3, images=1, videos=1, audio=1, bytes=1101)
    assert prune_scan.scan_state()["folders_scanned"] == 3
    assert prune_scan.get_node(os.path.join(root, "nope")) is None


def test_scan_skips_hidden_and_symlinks(tmp_path):
    (tmp_path / "ok.jpg").write_bytes(b"x")
    (tmp_path / ".hid.jpg").write_bytes(b"x")
    (tmp_path / ".hdir").mkdir()
    (tmp_path / ".hdir" / "z.jpg").write_bytes(b"x")
    outside = tmp_path.parent / (tmp_path.name + "-out")
    outside.mkdir()
    (outside / "o.jpg").write_bytes(b"x")
    (tmp_path / "link").symlink_to(outside)
    (tmp_path / "flink.jpg").symlink_to(outside / "o.jpg")
    scan(tmp_path.resolve())
    node = prune_scan.get_node(str(tmp_path.resolve()))
    assert node.total == Counts(files=1, images=1, bytes=1)
    assert node.children == {}


def test_scan_unicode_and_long_names(tmp_path):
    d = tmp_path / "한국어 폴더"
    d.mkdir()
    long_name = "a" * 196 + ".jpg"
    (d / long_name).write_bytes(b"xy")
    (d / "노래.mp3").write_bytes(b"x")
    scan(tmp_path.resolve())
    node = prune_scan.get_node(str((tmp_path / "한국어 폴더").resolve()))
    assert node.name == "한국어 폴더"
    assert node.direct == Counts(files=2, images=1, audio=1, bytes=3)


def test_apply_deleted_files_updates_ancestors(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    deep = os.path.join(root, "sub", "deep")
    prune_scan.apply_deleted_files(deep, Counts(files=1, audio=1, bytes=1000))
    assert prune_scan.get_node(deep).direct == Counts(files=1, images=1, bytes=1)
    assert prune_scan.get_node(deep).total == Counts(files=1, images=1, bytes=1)
    assert prune_scan.get_node(os.path.join(root, "sub")).total.files == 2
    assert prune_scan.get_node(root).total == Counts(
        files=4, images=2, videos=1, other=1, bytes=116
    )


def test_remove_folder_updates_ancestors(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    prune_scan.remove_folder(os.path.join(root, "sub", "deep"))
    assert prune_scan.get_node(os.path.join(root, "sub", "deep")) is None
    assert prune_scan.get_node(os.path.join(root, "sub")).total == Counts(
        files=1, videos=1, bytes=100
    )
    assert prune_scan.get_node(root).total == Counts(
        files=3, images=1, videos=1, other=1, bytes=115
    )
    prune_scan.remove_folder(root)  # root is never removable from the cache
    assert prune_scan.get_node(root) is not None


def test_apply_deleted_files_unknown_path_is_noop(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    before = prune_scan.get_node(root).total
    snap = Counts(**vars(before))
    prune_scan.apply_deleted_files(os.path.join(root, "nope"), Counts(files=1, bytes=5))
    prune_scan.apply_deleted_files("/elsewhere", Counts(files=1, bytes=5))
    assert prune_scan.get_node(root).total == snap


def test_apply_deleted_files_clamps_at_zero(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    deep = os.path.join(root, "sub", "deep")
    prune_scan.apply_deleted_files(deep, Counts(files=9, audio=9, images=9, bytes=99999))
    node = prune_scan.get_node(deep)
    assert node.direct == Counts() and node.total == Counts()
    for p in (root, os.path.join(root, "sub")):
        t = prune_scan.get_node(p).total
        assert min(vars(t).values()) >= 0


def test_remove_folder_clamps_and_unknown_noop(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    sub = prune_scan.get_node(os.path.join(root, "sub"))
    # simulate drift: the parent total is already lower than the child's
    prune_scan.get_node(root).total.files = 0
    prune_scan.get_node(root).total.bytes = 0
    prune_scan.remove_folder(os.path.join(root, "nope"))
    assert "sub" in prune_scan.get_node(root).children
    prune_scan.remove_folder(sub.path)
    t = prune_scan.get_node(root).total
    assert min(vars(t).values()) >= 0


def test_snapshot_copies_node(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    snap = prune_scan.snapshot(root)
    assert snap["name"] == os.path.basename(root)
    assert [c["name"] for c in snap["children"]] == ["sub"]
    assert snap["total"]["files"] == 5
    prune_scan.remove_folder(os.path.join(root, "sub"))
    assert [c["name"] for c in snap["children"]] == ["sub"]  # detached copy
    assert prune_scan.snapshot(os.path.join(root, "sub")) is None


def test_folder_view_breadcrumbs_parent_and_sorted_subfolders(tmp_path):
    root_p = make_tree(tmp_path)
    for n in ("B", "a", "한글"):
        (root_p / "sub" / n).mkdir()
    root = str(root_p.resolve())
    scan(root)

    top = prune_scan.folder_view(root, root)
    assert top["parent"] is None
    assert top["breadcrumbs"] == [{"name": os.path.basename(root), "path": root}]
    assert top["total"]["files"] == 5 and top["direct"]["files"] == 2

    sub = os.path.join(root, "sub")
    view = prune_scan.folder_view(root, sub)
    assert view["path"] == sub and view["name"] == "sub" and view["parent"] == root
    assert [s["name"] for s in view["subfolders"]] == ["a", "B", "deep", "한글"]  # casefold

    deep = prune_scan.folder_view(root, os.path.join(sub, "deep"))
    assert deep["breadcrumbs"] == [
        {"name": os.path.basename(root), "path": root},
        {"name": "sub", "path": sub},
        {"name": "deep", "path": os.path.join(sub, "deep")},
    ]
    assert prune_scan.folder_view(root, os.path.join(root, "nope")) is None


def test_invalidate_clears(tmp_path):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    prune_scan.invalidate()
    assert prune_scan.get_node(root) is None
    assert prune_scan.scan_state() == {"status": "idle", "folders_scanned": 0, "root": None}


def test_start_scan_idempotent_while_running(tmp_path, monkeypatch):
    prune_scan._state["status"] = "running"
    started = []
    monkeypatch.setattr(prune_scan.threading, "Thread", lambda **kw: started.append(kw))
    prune_scan.start_scan(str(tmp_path))
    assert started == []


def test_start_scan_reuses_done_cache_for_same_root(tmp_path, monkeypatch):
    root = str(make_tree(tmp_path).resolve())
    scan(root)
    started = []

    class FakeThread:
        def __init__(self, **kw):
            started.append(kw)

        def start(self):
            pass

    monkeypatch.setattr(prune_scan.threading, "Thread", FakeThread)
    prune_scan.start_scan(root)  # done + same root: cache kept, no new scan
    assert started == [] and prune_scan.scan_state()["status"] == "done"
    prune_scan.start_scan(root, force=True)
    assert len(started) == 1


# ── scan races: generation + dirty rescans, driven synchronously ──────────────


@pytest.fixture
def threads(monkeypatch):
    """Capture scan threads instead of starting them; tests run them by hand."""
    captured: list[tuple] = []

    class FakeThread:
        def __init__(self, target, args, daemon=None):
            captured.append((target, args))

        def start(self):
            pass

    monkeypatch.setattr(prune_scan.threading, "Thread", FakeThread)
    return captured


@pytest.fixture
def on_scandir(monkeypatch):
    """Run a callback once, right before the walk lists a given folder."""
    hooks: dict[str, list] = {}
    calls: list[str] = []
    real = prune_scan.os.scandir

    def fake(path):
        calls.append(str(path))
        for fn in hooks.pop(str(path), []):
            fn()
        return real(path)

    monkeypatch.setattr(prune_scan.os, "scandir", fake)

    def add(path, fn):
        hooks.setdefault(str(path), []).append(fn)

    add.calls = calls
    return add


def _run(captured):
    target, args = captured
    target(*args)


def test_stale_scan_cannot_report_progress_or_swap_result(tmp_path, threads, on_scandir):
    root = str(make_tree(tmp_path).resolve())
    prune_scan.start_scan(root)
    prune_scan.invalidate()
    other = tmp_path / "sub"
    prune_scan.start_scan(str(other))
    _run(threads[0])  # the superseded scan
    assert on_scandir.calls == []  # stopped before walking anything
    state = prune_scan.scan_state()
    assert state == {"status": "running", "folders_scanned": 0, "root": str(other)}
    assert prune_scan.get_node(root) is None
    _run(threads[1])
    assert prune_scan.scan_state()["status"] == "done"
    assert prune_scan.get_node(str(other)).total.files == 3


def test_scan_invalidated_mid_walk_stops_early(tmp_path, threads, on_scandir):
    root = str(make_tree(tmp_path).resolve())
    sub = os.path.join(root, "sub")
    prune_scan.start_scan(root)

    def supersede():
        prune_scan.invalidate()
        prune_scan.start_scan(sub)

    on_scandir(sub, supersede)
    _run(threads[0])
    # the stale walk never reached sub/deep and touched nothing
    assert os.path.join(sub, "deep") not in on_scandir.calls
    assert prune_scan.scan_state() == {"status": "running", "folders_scanned": 0, "root": sub}
    assert prune_scan.get_node(root) is None


def test_file_delete_during_scan_is_not_lost(tmp_path, threads, on_scandir):
    root = str(make_tree(tmp_path).resolve())
    prune_scan.start_scan(root)
    deep = os.path.join(root, "sub", "deep")

    def delete_counted_file():  # a.jpg in the root was already counted
        os.remove(os.path.join(root, "a.jpg"))
        prune_scan.apply_deleted_files(root, prune_scan.file_counts("a.jpg", 10))

    on_scandir(deep, delete_counted_file)
    _run(threads[0])
    assert prune_scan.scan_state()["status"] == "done"
    assert prune_scan.get_node(root).direct == Counts(files=1, other=1, bytes=5)
    assert prune_scan.get_node(root).total.files == 4
    assert on_scandir.calls.count(root) == 2  # exactly one extra pass, no loop


def test_folder_delete_during_scan_is_not_lost(tmp_path, threads, on_scandir):
    import shutil

    root = str(make_tree(tmp_path).resolve())
    sub = os.path.join(root, "sub")
    deep = os.path.join(sub, "deep")
    prune_scan.start_scan(root)

    def delete_walked_folder():  # sub was listed, deep is about to be
        shutil.rmtree(deep)
        prune_scan.remove_folder(deep)

    on_scandir(deep, delete_walked_folder)
    _run(threads[0])
    assert prune_scan.scan_state()["status"] == "done"
    assert prune_scan.get_node(deep) is None
    assert prune_scan.get_node(sub).total == Counts(files=1, videos=1, bytes=100)
    assert prune_scan.scan_state()["folders_scanned"] == 2  # progress of the final pass only


def test_dirty_rescans_are_bounded(tmp_path, threads, on_scandir):
    root = str(make_tree(tmp_path).resolve())
    prune_scan.start_scan(root)
    hits = []

    def keep_deleting():  # a delete lands during every single pass
        hits.append(1)
        prune_scan.apply_deleted_files(root, Counts())
        on_scandir(root, keep_deleting)

    on_scandir(root, keep_deleting)
    _run(threads[0])
    assert prune_scan.scan_state()["status"] == "done"
    assert len(hits) == prune_scan._MAX_PASSES
    assert prune_scan.get_node(root) is not None
