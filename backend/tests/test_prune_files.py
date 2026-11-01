import os
import time

import pytest

from app.services import prune_files, prune_scan
from app.services.prune_sandbox import SandboxError


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


def test_list_files_kinds_and_unicode(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"xx")
    (tmp_path / "한글 영상.mp4").write_bytes(b"x" * 7)
    (tmp_path / "new\nline.mp3").write_bytes(b"x")
    (tmp_path / "notes.txt").write_bytes(b"x")
    long_name = "ㄱ" * 80 + ".png"  # 240 bytes
    (tmp_path / long_name).write_bytes(b"x")
    (tmp_path / ".hidden.jpg").write_bytes(b"x")
    (tmp_path / "sub").mkdir()
    (tmp_path / "link.jpg").symlink_to(tmp_path / "a.jpg")
    out = {f["name"]: f for f in prune_files.list_files(str(tmp_path))}
    assert set(out) == {"a.jpg", "한글 영상.mp4", "new\nline.mp3", "notes.txt", long_name}
    assert out["a.jpg"]["kind"] == "image" and out["a.jpg"]["size"] == 2
    assert out["한글 영상.mp4"]["kind"] == "video"
    assert out["new\nline.mp3"]["kind"] == "audio"
    assert out["notes.txt"]["kind"] == "other"
    assert out["a.jpg"]["path"] == os.path.join(str(tmp_path), "a.jpg")
    assert isinstance(out["a.jpg"]["mtime"], float)


def test_delete_files_updates_cache_and_reports_empty_folder(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "keep.jpg").write_bytes(b"x")
    (tmp_path / "sub").mkdir()
    f = tmp_path / "sub" / "한글\n.mp4"
    f.write_bytes(b"x" * 50)
    scan(root)
    res = prune_files.delete_files(root, [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["failed"] == []
    assert res["empty_folders"] == [os.path.join(root, "sub")]
    assert not f.exists()
    top = prune_scan.get_node(root)
    assert top.total.files == 1 and top.total.videos == 0 and top.total.bytes == 1
    assert prune_scan.get_node(os.path.join(root, "sub")).direct.files == 0


def test_delete_does_not_report_folder_with_hidden_entry(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "sub").mkdir()
    f = tmp_path / "sub" / "a.jpg"
    f.write_bytes(b"x")
    (tmp_path / "sub" / ".hidden").write_bytes(b"x")
    scan(root)
    res = prune_files.delete_files(root, [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["empty_folders"] == []


def test_delete_does_not_report_folder_with_other_entries(tmp_path):
    root = str(tmp_path.resolve())
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    (tmp_path / "notes.txt").write_bytes(b"x")
    res = prune_files.delete_files(root, [str(f)])
    assert res["empty_folders"] == []


def test_delete_missing_file_is_failed_not_raised(tmp_path):
    root = str(tmp_path.resolve())
    ok = tmp_path / "ok.jpg"
    ok.write_bytes(b"x")
    gone = tmp_path / "gone.jpg"
    res = prune_files.delete_files(root, [str(gone), str(ok), "\x00bad"])
    assert res["deleted"] == [str(ok)]
    assert [f["path"] for f in res["failed"]] == [str(gone), "\x00bad"]
    assert all(f["error"] for f in res["failed"])


def test_delete_refuses_symlink_and_directory(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    target = tmp_path / "outside.jpg"
    target.write_bytes(b"x")
    inner = root / "inner.jpg"
    inner.write_bytes(b"x")
    (root / "link_out.jpg").symlink_to(target)
    (root / "link_in.jpg").symlink_to(inner)
    (root / "d").mkdir()
    paths = [str(root / "link_out.jpg"), str(root / "link_in.jpg"), str(root / "d")]
    res = prune_files.delete_files(str(root), paths)
    assert res["deleted"] == []
    assert [f["path"] for f in res["failed"]] == paths
    assert target.exists() and inner.exists()
    assert (root / "link_out.jpg").is_symlink() and (root / "d").is_dir()


def test_delete_outside_root_rejected(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    evil = tmp_path / "root-evil"
    evil.mkdir()
    victim = evil / "a.jpg"
    victim.write_bytes(b"x")
    res = prune_files.delete_files(
        str(root), [str(victim), str(root / ".." / "root-evil" / "a.jpg")]
    )
    assert res["deleted"] == []
    assert len(res["failed"]) == 2
    assert victim.exists()


def test_delete_folder_trailing_slash_symlink_refused(tmp_path):
    root = tmp_path / "root"
    (root / "real").mkdir(parents=True)
    (root / "real" / "a.jpg").write_bytes(b"x")
    (root / "ln").symlink_to(root / "real")
    for suffix in ("/", "//"):
        with pytest.raises(SandboxError) as e:
            prune_files.delete_folder(str(root), str(root / "ln") + suffix)
        assert e.value.status == 400
    assert (root / "real" / "a.jpg").exists() and (root / "ln").is_symlink()


def test_delete_files_trailing_slash_symlink_refused(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "a.jpg").write_bytes(b"x")
    (root / "ln.jpg").symlink_to(root / "a.jpg")
    res = prune_files.delete_files(str(root), [str(root / "ln.jpg") + "/"])
    assert res["deleted"] == [] and len(res["failed"]) == 1
    assert (root / "a.jpg").exists() and (root / "ln.jpg").is_symlink()


def test_empty_folders_never_includes_root(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    f = root / "a.jpg"
    f.write_bytes(b"x")
    res = prune_files.delete_files(str(root), [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["empty_folders"] == []


def test_delete_missing_path_outside_root_reports_outside(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    res = prune_files.delete_files(str(root), [str(tmp_path / "nope.jpg")])
    assert res["failed"][0]["error"] == "Path is outside the root folder"


def test_delete_refuses_hidden_file(tmp_path):
    f = tmp_path / ".secret.jpg"
    f.write_bytes(b"x")
    res = prune_files.delete_files(str(tmp_path), [str(f)])
    assert res["deleted"] == [] and len(res["failed"]) == 1
    assert f.exists()


def test_delete_folder_recursive_with_hidden_and_symlink_inside(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.jpg").write_bytes(b"x")
    d = root / "d"
    (d / "deeper").mkdir(parents=True)
    (d / "deeper" / "a.jpg").write_bytes(b"x")
    (d / ".hidden").write_bytes(b"x")
    (d / "link").symlink_to(outside)
    (root / "other.jpg").write_bytes(b"xx")
    scan(root.resolve())
    prune_files.delete_folder(str(root), str(d))
    assert not d.exists()
    assert (outside / "keep.jpg").exists()
    rn = prune_scan.get_node(str(root.resolve()))
    assert rn.total.files == 1 and "d" not in rn.children


def test_delete_folder_refuses_root(tmp_path):
    with pytest.raises(SandboxError) as e:
        prune_files.delete_folder(str(tmp_path), str(tmp_path))
    assert e.value.status == 400
    assert tmp_path.exists()


def test_delete_folder_refuses_file_and_symlink(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "f.txt").write_bytes(b"x")
    (root / "ln").symlink_to(outside)
    for p in (root / "f.txt", root / "ln"):
        with pytest.raises(SandboxError) as e:
            prune_files.delete_folder(str(root), str(p))
        assert e.value.status == 400
    assert outside.exists() and (root / "ln").is_symlink()


def test_delete_folder_outside_root_and_nul(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    other = tmp_path / "root-evil"
    other.mkdir()
    with pytest.raises(SandboxError) as e:
        prune_files.delete_folder(str(root), str(other))
    assert e.value.status == 403
    with pytest.raises(SandboxError) as e:
        prune_files.delete_folder(str(root), str(root) + "/\x00")
    assert e.value.status == 400
    assert other.exists()
