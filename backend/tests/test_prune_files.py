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


def test_delete_folder_refuses_hidden_dir(tmp_path):
    (tmp_path / ".git" / "objects").mkdir(parents=True)
    for p in (tmp_path / ".git", tmp_path / ".git" / "objects"):
        with pytest.raises(SandboxError) as e:
            prune_files.delete_folder(str(tmp_path), str(p))
        assert e.value.status == 400
    assert (tmp_path / ".git" / "objects").is_dir()


def test_delete_folder_only_if_empty(tmp_path):
    root = tmp_path.resolve()
    (root / "empty").mkdir()
    (root / "full").mkdir()
    (root / "full" / ".keep").write_bytes(b"x")
    (root / "a.jpg").write_bytes(b"x")
    scan(root)
    prune_files.delete_folder(str(root), str(root / "empty"), only_if_empty=True)
    assert not (root / "empty").exists()
    assert "empty" not in prune_scan.get_node(str(root)).children
    with pytest.raises(SandboxError) as e:
        prune_files.delete_folder(str(root), str(root / "full"), only_if_empty=True)
    assert e.value.status == 409 and str(e.value) == "Folder is no longer empty"
    assert (root / "full" / ".keep").exists()
    assert "full" in prune_scan.get_node(str(root)).children  # cache untouched


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


# ── details (ffprobe + LRU) ──────────────────────────────────────────────────

_VIDEO_PROBE = {
    "streams": [{"codec_name": "h264", "width": 1920, "height": 1080, "duration": "9.0"}],
    "format": {"duration": "10.5", "bit_rate": "2000000"},
}
_AUDIO_PROBE = {
    "streams": [{"codec_name": "opus", "bit_rate": "96000"}],
    "format": {"duration": "30.0"},
}


@pytest.fixture
def probes(monkeypatch):
    calls: list[str] = []

    def video(path):
        calls.append(path)
        return _VIDEO_PROBE

    def audio(path):
        calls.append(path)
        return _AUDIO_PROBE

    monkeypatch.setattr(prune_files, "probe_file", video)
    monkeypatch.setattr(prune_files, "probe_audio", audio)
    prune_files.clear_details_cache()
    return calls


def test_details_cached_by_path_size_mtime(tmp_path, probes):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    p = str(f)
    first = prune_files.get_details([p])[p]
    assert first == {
        "duration": 10.5,
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "bitrate": 2000000,
    }
    assert prune_files.get_details([p])[p] == first
    assert len(probes) == 1
    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    prune_files.get_details([p])
    assert len(probes) == 2


def test_details_audio_and_unicode(tmp_path, probes):
    f = tmp_path / "한글\n.mp3"
    f.write_bytes(b"x")
    d = prune_files.get_details([str(f)])[str(f)]
    assert d["codec"] == "opus" and d["bitrate"] == 96000 and d["duration"] == 30.0
    assert d["width"] is None and d["height"] is None


def test_details_corrupt_image_and_other_are_null(tmp_path, probes):
    (tmp_path / "a.jpg").write_bytes(b"x")  # not a real JPEG
    (tmp_path / "n.txt").write_bytes(b"x")
    (tmp_path / ".h.mp4").write_bytes(b"x")
    (tmp_path / "ok.mp4").write_bytes(b"x")
    (tmp_path / "link.mp4").symlink_to(tmp_path / "ok.mp4")
    paths = [str(tmp_path / n) for n in ("a.jpg", "n.txt", ".h.mp4", "gone.mp4", "link.mp4")]
    out = prune_files.get_details(paths)
    assert all(out[p] is None for p in paths)
    assert probes == []


def test_details_images_read_header_size_and_format(tmp_path, probes):
    from PIL import Image

    Image.new("RGB", (40, 30), "red").save(tmp_path / "a.png")
    Image.new("RGB", (8, 6), "blue").save(tmp_path / "b.webp")
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90: displayed portrait
    Image.new("RGB", (40, 30), "green").save(tmp_path / "r.jpg", exif=exif)
    paths = {n: str(tmp_path / n) for n in ("a.png", "b.webp", "r.jpg")}
    out = prune_files.get_details(list(paths.values()))
    assert out[paths["a.png"]] == {
        "duration": None,
        "width": 40,
        "height": 30,
        "codec": "png",
        "bitrate": None,
    }
    assert out[paths["b.webp"]]["codec"] == "webp" and out[paths["b.webp"]]["width"] == 8
    assert (out[paths["r.jpg"]]["width"], out[paths["r.jpg"]]["height"]) == (30, 40)
    assert out[paths["r.jpg"]]["codec"] == "jpeg"
    assert probes == []  # no ffprobe for images


def test_details_image_cached_and_corrupt_or_bomb_is_null(tmp_path, monkeypatch):
    import warnings

    from PIL import Image

    prune_files.clear_details_cache()
    Image.new("RGB", (40, 30)).save(tmp_path / "a.png")
    (tmp_path / "bad.png").write_bytes(b"\x89PNG\r\n\x1a\n garbage")
    p, bad = str(tmp_path / "a.png"), str(tmp_path / "bad.png")
    opens = []
    real_open = prune_files.Image.open
    monkeypatch.setattr(prune_files.Image, "open", lambda f: opens.append(f) or real_open(f))
    assert prune_files.get_details([p])[p]["width"] == 40
    assert prune_files.get_details([p])[p]["width"] == 40
    assert len(opens) == 1  # LRU hit, same (path, size, mtime_ns) key
    assert prune_files.get_details([bad])[bad] is None
    prune_files.clear_details_cache()
    with warnings.catch_warnings():
        # test-side only: prune_files sets no warning filter (catch_warnings is not
        # thread-safe on the probe pool); a bomb *warning* is not an error there
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # 1200 px: warning only
        assert prune_files.get_details([p])[p]["height"] == 30
        prune_files.clear_details_cache()
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)  # > 2x: DecompressionBombError
        assert prune_files.get_details([p])[p] is None


def test_details_probe_failure_is_null_and_not_cached(tmp_path, monkeypatch):
    f = tmp_path / "bad.mp4"
    f.write_bytes(b"x")
    n = []
    monkeypatch.setattr(prune_files, "probe_file", lambda p: n.append(p) or {})
    prune_files.clear_details_cache()
    assert prune_files.get_details([str(f)])[str(f)] is None
    prune_files.get_details([str(f)])
    assert len(n) == 2


def test_lru_evicts_oldest():
    c = prune_files.LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == 1  # refresh a; b is now oldest
    c.put("c", 3)
    assert c.get("b") is None
    assert c.get("a") == 1 and c.get("c") == 3


@pytest.fixture
def thumb_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbs"
    monkeypatch.setattr(prune_files, "THUMB_DIR", str(d))
    return d


def _png(path):
    from PIL import Image

    Image.new("RGB", (40, 30), "red").save(path)


def test_thumbnail_image_cached_and_key_changes_with_mtime(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    t1 = prune_files.thumbnail_for(str(img))
    assert t1 and os.path.dirname(t1) == str(thumb_dir) and os.path.exists(t1)
    assert prune_files.thumbnail_for(str(img)) == t1
    st = img.stat()
    os.utime(img, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    t2 = prune_files.thumbnail_for(str(img))
    assert t2 and t2 != t1


def test_thumbnail_cache_hit_refreshes_mtime(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    t = prune_files.thumbnail_for(str(img))
    old = time.time() - 10 * 86400
    os.utime(t, (old, old))
    assert prune_files.thumbnail_for(str(img)) == t
    assert os.path.getmtime(t) > time.time() - 60  # used thumbnails survive age eviction


# ── thumbnail cache eviction ─────────────────────────────────────────────────

_DAY = 86400
_NOW = 1_800_000_000.0


def _thumb(d, stem, size=10, age_days=0.0, suffix=".jpg"):
    p = d / f"{stem * 40}{suffix}"
    p.write_bytes(b"x" * size)
    t = _NOW - age_days * _DAY
    os.utime(p, (t, t))
    return p


def test_evict_removes_old_entries_only_inside_dir(tmp_path):
    d = tmp_path / "thumbs"
    d.mkdir()
    old = _thumb(d, "a", age_days=31)
    old_failed = _thumb(d, "b", age_days=40, suffix=".jpg.failed")
    fresh = _thumb(d, "c", age_days=29)
    stray = d / "notes.txt"
    stray.write_bytes(b"x")
    os.utime(stray, (0, 0))
    (d / "sub").mkdir()
    sub_old = _thumb(d / "sub", "d", age_days=99)
    outside = tmp_path / "precious.jpg"
    outside.write_bytes(b"keep")
    link = d / ("e" * 40 + ".jpg")
    link.symlink_to(outside)
    os.utime(link, (0, 0), follow_symlinks=False)
    removed = prune_files.evict_thumbnails(str(d), now=_NOW)
    assert removed == 2
    assert not old.exists() and not old_failed.exists()
    assert fresh.exists() and stray.exists() and sub_old.exists()
    assert link.is_symlink() and outside.read_bytes() == b"keep"


def test_evict_size_cap_drops_oldest_first(tmp_path):
    d = tmp_path / "thumbs"
    d.mkdir()
    a = _thumb(d, "a", size=100, age_days=3)
    b = _thumb(d, "b", size=100, age_days=2)
    c = _thumb(d, "c", size=100, age_days=1)
    assert prune_files.evict_thumbnails(str(d), max_bytes=250, now=_NOW) == 1
    assert not a.exists() and b.exists() and c.exists()


def test_evict_size_cap_spares_young_inflight_tmp(tmp_path):
    d = tmp_path / "thumbs"
    d.mkdir()
    tmp = _thumb(d, "a", size=100, age_days=0.5 / 24, suffix=".123.tmp.jpg")  # 30 min, writing
    old_tmp = _thumb(d, "b", size=100, age_days=2 / 24, suffix=".123.tmp.jpg")  # abandoned
    done = _thumb(d, "c", size=100, age_days=1 / 24)
    assert prune_files.evict_thumbnails(str(d), max_bytes=0, now=_NOW) == 2
    assert tmp.exists() and not old_tmp.exists() and not done.exists()


def test_evict_never_raises(tmp_path, monkeypatch):
    assert prune_files.evict_thumbnails(str(tmp_path / "missing"), now=_NOW) == 0
    d = tmp_path / "thumbs"
    d.mkdir()
    _thumb(d, "a", age_days=31)

    def boom(_):
        raise PermissionError("nope")

    monkeypatch.setattr(prune_files.os, "remove", boom)
    assert prune_files.evict_thumbnails(str(d), now=_NOW) == 0


def test_maybe_evict_runs_at_most_once_per_interval(tmp_path, monkeypatch, thumb_dir):
    started = []

    class FakeThread:
        def __init__(self, target, args, daemon=None):
            started.append(args)

        def start(self):
            pass

    monkeypatch.setattr(prune_files.threading, "Thread", FakeThread)
    monkeypatch.setattr(prune_files, "_last_evict", 0.0)
    assert prune_files.maybe_evict_thumbnails(now=_NOW) is True
    assert prune_files.maybe_evict_thumbnails(now=_NOW + 60) is False
    later = _NOW + prune_files._EVICT_INTERVAL + 1
    assert prune_files.maybe_evict_thumbnails(now=later) is True
    assert started == [(str(thumb_dir),), (str(thumb_dir),)]  # dir captured at spawn


def test_thumbnail_none_for_audio_and_other(tmp_path, thumb_dir):
    for n in ("a.mp3", "n.txt"):
        (tmp_path / n).write_bytes(b"x")
        assert prune_files.thumbnail_for(str(tmp_path / n)) is None


def test_thumbnail_video_uses_frame_grab_and_marks_failure(tmp_path, thumb_dir, monkeypatch):
    v = tmp_path / "v.mp4"
    v.write_bytes(b"x")
    calls = []

    def fake(src, out, duration=None):
        calls.append(out)
        return False

    monkeypatch.setattr(prune_files, "grab_frame", fake)
    assert prune_files.thumbnail_for(str(v)) is None
    assert prune_files.thumbnail_for(str(v)) is None  # .failed marker: no retry
    assert len(calls) == 1


def test_thumbnail_rejects_symlink_and_hidden(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    (tmp_path / "ln.png").symlink_to(img)
    _png(tmp_path / ".h.png")
    assert prune_files.thumbnail_for(str(tmp_path / "ln.png")) is None
    assert prune_files.thumbnail_for(str(tmp_path / ".h.png")) is None
    assert prune_files.thumbnail_for(str(tmp_path / "missing.png")) is None
