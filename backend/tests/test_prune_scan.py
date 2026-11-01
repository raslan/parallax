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
