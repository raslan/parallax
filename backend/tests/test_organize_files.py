import os
import time

import pytest

from app.services import audio_scanner, organize_files, organize_scan, scanner
from app.services.organize_sandbox import FolderNotEmpty, InvalidPath, OutsideRoot, PathNotFound


@pytest.fixture(autouse=True)
def _reset():
    organize_scan.invalidate()
    yield
    organize_scan.invalidate()


def scan(root):
    organize_scan.start_scan(str(root))
    for _ in range(200):
        if organize_scan.scan_state()["status"] != "running":
            break
        time.sleep(0.05)
    assert organize_scan.scan_state()["status"] == "done"


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
    out = {f["name"]: f for f in organize_files.list_files(str(tmp_path))}
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
    res = organize_files.delete_files(root, [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["failed"] == []
    assert res["empty_folders"] == [os.path.join(root, "sub")]
    assert not f.exists()
    top = organize_scan.get_node(root)
    assert top.total.files == 1 and top.total.videos == 0 and top.total.bytes == 1
    assert organize_scan.get_node(os.path.join(root, "sub")).direct.files == 0


@pytest.fixture
def removals(monkeypatch):
    from app.services import stats

    calls: list[tuple] = []
    monkeypatch.setattr(stats, "record_removal", lambda *a: calls.append(a))
    return calls


def test_delete_files_records_one_removal_per_media_kind(tmp_path, removals):
    """Dashboard parity with Cleanup/audio/image deletes: file-agnostic events
    (media, file count, bytes) for the files actually deleted, nothing else."""
    root = str(tmp_path.resolve())
    for name, size in (("a.jpg", 3), ("b.png", 2), ("v.mp4", 5), ("n.txt", 1), ("s.mp3", 7)):
        (tmp_path / name).write_bytes(b"x" * size)
    (tmp_path / "d").mkdir()
    paths = [str(tmp_path / n) for n in ("a.jpg", "b.png", "v.mp4", "n.txt", "s.mp3")]
    res = organize_files.delete_files(
        root, [*paths, str(tmp_path / "gone.jpg"), str(tmp_path / "d")]
    )
    assert len(res["deleted"]) == 5 and len(res["failed"]) == 2
    assert sorted(removals) == [
        ("audio", 1, 7),
        ("image", 2, 5),
        ("other", 1, 1),
        ("video", 1, 5),
    ]


def test_delete_files_records_nothing_when_nothing_deleted(tmp_path, removals):
    res = organize_files.delete_files(str(tmp_path), [str(tmp_path / "gone.jpg")])
    assert res["deleted"] == [] and removals == []


def test_delete_folder_records_no_stats(tmp_path, removals):
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "a.jpg").write_bytes(b"xx")
    (tmp_path / "e").mkdir()
    organize_files.delete_folder(str(tmp_path), str(tmp_path / "d"))
    organize_files.delete_folder(str(tmp_path), str(tmp_path / "e"), only_if_empty=True)
    assert removals == []


def test_delete_does_not_report_folder_with_hidden_entry(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "sub").mkdir()
    f = tmp_path / "sub" / "a.jpg"
    f.write_bytes(b"x")
    (tmp_path / "sub" / ".hidden").write_bytes(b"x")
    scan(root)
    res = organize_files.delete_files(root, [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["empty_folders"] == []


def test_delete_does_not_report_folder_with_other_entries(tmp_path):
    root = str(tmp_path.resolve())
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    (tmp_path / "notes.txt").write_bytes(b"x")
    res = organize_files.delete_files(root, [str(f)])
    assert res["empty_folders"] == []


def test_delete_missing_file_is_failed_not_raised(tmp_path):
    root = str(tmp_path.resolve())
    ok = tmp_path / "ok.jpg"
    ok.write_bytes(b"x")
    gone = tmp_path / "gone.jpg"
    res = organize_files.delete_files(root, [str(gone), str(ok), "\x00bad"])
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
    res = organize_files.delete_files(str(root), paths)
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
    res = organize_files.delete_files(
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
        with pytest.raises(InvalidPath):
            organize_files.delete_folder(str(root), str(root / "ln") + suffix)
    assert (root / "real" / "a.jpg").exists() and (root / "ln").is_symlink()


def test_delete_files_trailing_slash_symlink_refused(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "a.jpg").write_bytes(b"x")
    (root / "ln.jpg").symlink_to(root / "a.jpg")
    res = organize_files.delete_files(str(root), [str(root / "ln.jpg") + "/"])
    assert res["deleted"] == [] and len(res["failed"]) == 1
    assert (root / "a.jpg").exists() and (root / "ln.jpg").is_symlink()


def test_empty_folders_never_includes_root(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    f = root / "a.jpg"
    f.write_bytes(b"x")
    res = organize_files.delete_files(str(root), [str(f)])
    assert res["deleted"] == [str(f)]
    assert res["empty_folders"] == []


def test_delete_missing_path_outside_root_reports_outside(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    res = organize_files.delete_files(str(root), [str(tmp_path / "nope.jpg")])
    assert res["failed"][0]["error"] == "Path is outside the root folder"


def test_delete_refuses_hidden_file(tmp_path):
    f = tmp_path / ".secret.jpg"
    f.write_bytes(b"x")
    res = organize_files.delete_files(str(tmp_path), [str(f)])
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
    organize_files.delete_folder(str(root), str(d))
    assert not d.exists()
    assert (outside / "keep.jpg").exists()
    rn = organize_scan.get_node(str(root.resolve()))
    assert rn.total.files == 1 and "d" not in rn.children


def test_delete_folder_refuses_root(tmp_path):
    with pytest.raises(InvalidPath):
        organize_files.delete_folder(str(tmp_path), str(tmp_path))
    assert tmp_path.exists()


def test_delete_folder_refuses_file_and_symlink(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "f.txt").write_bytes(b"x")
    (root / "ln").symlink_to(outside)
    for p in (root / "f.txt", root / "ln"):
        with pytest.raises(InvalidPath):
            organize_files.delete_folder(str(root), str(p))
    assert outside.exists() and (root / "ln").is_symlink()


def test_delete_folder_refuses_hidden_dir(tmp_path):
    (tmp_path / ".git" / "objects").mkdir(parents=True)
    for p in (tmp_path / ".git", tmp_path / ".git" / "objects"):
        with pytest.raises(InvalidPath):
            organize_files.delete_folder(str(tmp_path), str(p))
    assert (tmp_path / ".git" / "objects").is_dir()


def test_delete_folder_only_if_empty(tmp_path):
    root = tmp_path.resolve()
    (root / "empty").mkdir()
    (root / "full").mkdir()
    (root / "full" / ".keep").write_bytes(b"x")
    (root / "a.jpg").write_bytes(b"x")
    scan(root)
    organize_files.delete_folder(str(root), str(root / "empty"), only_if_empty=True)
    assert not (root / "empty").exists()
    assert "empty" not in organize_scan.get_node(str(root)).children
    with pytest.raises(FolderNotEmpty) as e:
        organize_files.delete_folder(str(root), str(root / "full"), only_if_empty=True)
    assert str(e.value) == "Folder is no longer empty"
    assert (root / "full" / ".keep").exists()
    assert "full" in organize_scan.get_node(str(root)).children  # cache untouched


def test_delete_folder_rmtree_failure_is_delete_failed(tmp_path, monkeypatch):
    from app.services.organize_sandbox import DeleteFailed

    (tmp_path / "d").mkdir()

    def boom(path):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(organize_files.shutil, "rmtree", boom)
    with pytest.raises(DeleteFailed) as e:
        organize_files.delete_folder(str(tmp_path), str(tmp_path / "d"))
    assert str(e.value) == "Could not delete folder: Permission denied"


def test_delete_folder_outside_root_and_nul(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    other = tmp_path / "root-evil"
    other.mkdir()
    with pytest.raises(OutsideRoot):
        organize_files.delete_folder(str(root), str(other))
    with pytest.raises(InvalidPath):
        organize_files.delete_folder(str(root), str(root) + "/\x00")
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

    # The shared ffprobe runners: Organize details come from the scanners' mappers.
    monkeypatch.setattr(scanner, "probe_file", video)
    monkeypatch.setattr(audio_scanner, "probe_audio", audio)
    organize_files.clear_details_cache()
    return calls


def test_details_follow_the_scanner_mapping_rules(tmp_path, monkeypatch):
    """Same field rules as the library rows: stream bit_rate before format bit_rate
    (Cleanup's "bitrate" meaning), duration from the container."""
    v = {
        "streams": [{"codec_name": "hevc", "width": 640, "height": 360, "bit_rate": "800000"}],
        "format": {"duration": "12.0", "bit_rate": "1000000"},
    }
    a = {"streams": [{"codec_name": "flac"}], "format": {"duration": "3.5", "bit_rate": "900000"}}
    monkeypatch.setattr(scanner, "probe_file", lambda p: v)
    monkeypatch.setattr(audio_scanner, "probe_audio", lambda p: a)
    organize_files.clear_details_cache()
    (tmp_path / "v.mkv").write_bytes(b"x")
    (tmp_path / "a.flac").write_bytes(b"x")
    out = organize_files.get_details([str(tmp_path / "v.mkv"), str(tmp_path / "a.flac")])
    assert out[str(tmp_path / "v.mkv")] == {
        "duration": 12.0,
        "width": 640,
        "height": 360,
        "codec": "hevc",
        "bitrate": 800000,
    }
    assert out[str(tmp_path / "a.flac")] == {
        "duration": 3.5,
        "width": None,
        "height": None,
        "codec": "flac",
        "bitrate": 900000,
    }


def test_details_audio_uses_the_guarded_probe(tmp_path, monkeypatch):
    """Audio goes through the scanner's dead-mount wall-clock guard."""
    seen: list[str] = []
    real = audio_scanner.probe_audio_metadata_guarded
    monkeypatch.setattr(
        audio_scanner, "probe_audio_metadata_guarded", lambda p: seen.append(p) or real(p)
    )
    monkeypatch.setattr(audio_scanner, "probe_audio", lambda p: {})
    organize_files.clear_details_cache()
    (tmp_path / "a.mp3").write_bytes(b"x")
    assert organize_files.get_details([str(tmp_path / "a.mp3")])[str(tmp_path / "a.mp3")] is None
    assert seen == [str(tmp_path / "a.mp3")]


def test_details_file_vanishing_mid_probe_is_null(tmp_path, monkeypatch):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")

    def gone(p):
        os.remove(p)  # the mapper's own getmtime then raises
        return _VIDEO_PROBE

    monkeypatch.setattr(scanner, "probe_file", gone)
    organize_files.clear_details_cache()
    assert organize_files.get_details([str(f)])[str(f)] is None


def test_details_malformed_probe_value_is_null(tmp_path, monkeypatch):
    """A mapper choking on a malformed ffprobe value nulls that file, not the batch."""
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    ok = tmp_path / "w.mp4"
    ok.write_bytes(b"x")

    def bad(p):
        if p == str(f):
            raise ValueError("invalid literal for int() with base 10: 'N/A'")
        return {
            "probe_ok": False,
            "file_width": None,
            "file_height": None,
            "video_bitrate": None,
        }

    monkeypatch.setattr(scanner, "probe_metadata", bad)
    organize_files.clear_details_cache()
    assert organize_files.get_details([str(f), str(ok)]) == {str(f): None, str(ok): None}


def test_details_cached_by_path_size_mtime(tmp_path, probes):
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    p = str(f)
    first = organize_files.get_details([p])[p]
    assert first == {
        "duration": 10.5,
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "bitrate": 2000000,
    }
    assert organize_files.get_details([p])[p] == first
    assert len(probes) == 1
    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    organize_files.get_details([p])
    assert len(probes) == 2


def test_details_audio_and_unicode(tmp_path, probes):
    f = tmp_path / "한글\n.mp3"
    f.write_bytes(b"x")
    d = organize_files.get_details([str(f)])[str(f)]
    assert d["codec"] == "opus" and d["bitrate"] == 96000 and d["duration"] == 30.0
    assert d["width"] is None and d["height"] is None


def test_details_corrupt_image_and_other_are_null(tmp_path, probes):
    (tmp_path / "a.jpg").write_bytes(b"x")  # not a real JPEG
    (tmp_path / "n.txt").write_bytes(b"x")
    (tmp_path / ".h.mp4").write_bytes(b"x")
    (tmp_path / "ok.mp4").write_bytes(b"x")
    (tmp_path / "link.mp4").symlink_to(tmp_path / "ok.mp4")
    paths = [str(tmp_path / n) for n in ("a.jpg", "n.txt", ".h.mp4", "gone.mp4", "link.mp4")]
    out = organize_files.get_details(paths)
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
    out = organize_files.get_details(list(paths.values()))
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

    organize_files.clear_details_cache()
    Image.new("RGB", (40, 30)).save(tmp_path / "a.png")
    (tmp_path / "bad.png").write_bytes(b"\x89PNG\r\n\x1a\n garbage")
    p, bad = str(tmp_path / "a.png"), str(tmp_path / "bad.png")
    opens = []
    real_open = organize_files.Image.open
    monkeypatch.setattr(organize_files.Image, "open", lambda f: opens.append(f) or real_open(f))
    assert organize_files.get_details([p])[p]["width"] == 40
    assert organize_files.get_details([p])[p]["width"] == 40
    assert len(opens) == 1  # LRU hit, same (path, size, mtime_ns) key
    assert organize_files.get_details([bad])[bad] is None
    organize_files.clear_details_cache()
    with warnings.catch_warnings():
        # test-side only: organize_files sets no warning filter (catch_warnings is not
        # thread-safe on the probe pool); a bomb *warning* is not an error there
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # 1200 px: warning only
        assert organize_files.get_details([p])[p]["height"] == 30
        organize_files.clear_details_cache()
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)  # > 2x: DecompressionBombError
        assert organize_files.get_details([p])[p] is None


def test_details_probe_failure_is_null_and_not_cached(tmp_path, monkeypatch):
    f = tmp_path / "bad.mp4"
    f.write_bytes(b"x")
    n = []
    monkeypatch.setattr(scanner, "probe_file", lambda p: n.append(p) or {})
    organize_files.clear_details_cache()
    assert organize_files.get_details([str(f)])[str(f)] is None
    organize_files.get_details([str(f)])
    assert len(n) == 2


def test_lru_evicts_oldest():
    c = organize_files.LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == 1  # refresh a; b is now oldest
    c.put("c", 3)
    assert c.get("b") is None
    assert c.get("a") == 1 and c.get("c") == 3


@pytest.fixture
def thumb_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbs"
    monkeypatch.setattr(organize_files, "THUMB_DIR", str(d))
    return d


def _png(path):
    from PIL import Image

    Image.new("RGB", (40, 30), "red").save(path)


def test_thumbnail_image_cached_and_key_changes_with_mtime(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    t1 = organize_files.thumbnail_for(str(img))
    assert t1 and os.path.dirname(t1) == str(thumb_dir) and os.path.exists(t1)
    assert organize_files.thumbnail_for(str(img)) == t1
    st = img.stat()
    os.utime(img, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    t2 = organize_files.thumbnail_for(str(img))
    assert t2 and t2 != t1


def test_thumbnail_cache_hit_refreshes_mtime(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    t = organize_files.thumbnail_for(str(img))
    old = time.time() - 10 * 86400
    os.utime(t, (old, old))
    assert organize_files.thumbnail_for(str(img)) == t
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
    removed = organize_files.evict_thumbnails(str(d), now=_NOW)
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
    assert organize_files.evict_thumbnails(str(d), max_bytes=250, now=_NOW) == 1
    assert not a.exists() and b.exists() and c.exists()


def test_evict_size_cap_spares_young_inflight_tmp(tmp_path):
    d = tmp_path / "thumbs"
    d.mkdir()
    tmp = _thumb(d, "a", size=100, age_days=0.5 / 24, suffix=".123.tmp.jpg")  # 30 min, writing
    old_tmp = _thumb(d, "b", size=100, age_days=2 / 24, suffix=".123.tmp.jpg")  # abandoned
    done = _thumb(d, "c", size=100, age_days=1 / 24)
    assert organize_files.evict_thumbnails(str(d), max_bytes=0, now=_NOW) == 2
    assert tmp.exists() and not old_tmp.exists() and not done.exists()


def test_evict_never_raises(tmp_path, monkeypatch):
    assert organize_files.evict_thumbnails(str(tmp_path / "missing"), now=_NOW) == 0
    d = tmp_path / "thumbs"
    d.mkdir()
    _thumb(d, "a", age_days=31)

    def boom(_):
        raise PermissionError("nope")

    monkeypatch.setattr(organize_files.os, "remove", boom)
    assert organize_files.evict_thumbnails(str(d), now=_NOW) == 0


def test_maybe_evict_runs_at_most_once_per_interval(tmp_path, monkeypatch, thumb_dir):
    started = []

    class FakeThread:
        def __init__(self, target, args, daemon=None):
            started.append(args)

        def start(self):
            pass

    monkeypatch.setattr(organize_files.threading, "Thread", FakeThread)
    monkeypatch.setattr(organize_files, "_last_evict", 0.0)
    assert organize_files.maybe_evict_thumbnails(now=_NOW) is True
    assert organize_files.maybe_evict_thumbnails(now=_NOW + 60) is False
    later = _NOW + organize_files._EVICT_INTERVAL + 1
    assert organize_files.maybe_evict_thumbnails(now=later) is True
    assert started == [(str(thumb_dir),), (str(thumb_dir),)]  # dir captured at spawn


def test_thumbnail_none_for_audio_and_other(tmp_path, thumb_dir):
    for n in ("a.mp3", "n.txt"):
        (tmp_path / n).write_bytes(b"x")
        assert organize_files.thumbnail_for(str(tmp_path / n)) is None


def test_thumbnail_video_uses_frame_grab_and_marks_failure(tmp_path, thumb_dir, monkeypatch):
    v = tmp_path / "v.mp4"
    v.write_bytes(b"x")
    calls = []

    def fake(src, out, duration=None):
        calls.append(out)
        return False

    monkeypatch.setattr(organize_files, "grab_frame", fake)
    assert organize_files.thumbnail_for(str(v)) is None
    assert organize_files.thumbnail_for(str(v)) is None  # .failed marker: no retry
    assert len(calls) == 1


def test_thumbnail_rejects_symlink_and_hidden(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    (tmp_path / "ln.png").symlink_to(img)
    _png(tmp_path / ".h.png")
    assert organize_files.thumbnail_for(str(tmp_path / "ln.png")) is None
    assert organize_files.thumbnail_for(str(tmp_path / ".h.png")) is None
    assert organize_files.thumbnail_for(str(tmp_path / "missing.png")) is None


def test_move_to_subfolder_moves_files_and_updates_cache(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "a.jpg").write_bytes(b"xx")
    (tmp_path / "b.mp4").write_bytes(b"x" * 5)
    (tmp_path / "keep.mp3").write_bytes(b"x")
    scan(root)
    res = organize_files.move_to_subfolder(
        root, root, [os.path.join(root, "a.jpg"), os.path.join(root, "b.mp4")], "Trip"
    )
    dest = os.path.join(root, "Trip")
    assert res["folder"] == dest
    assert res["moved"] == [os.path.join(root, "a.jpg"), os.path.join(root, "b.mp4")]
    assert res["failed"] == []
    assert (tmp_path / "Trip" / "a.jpg").exists() and not (tmp_path / "a.jpg").exists()
    top = organize_scan.get_node(root)
    assert top.direct.files == 1 and top.total.files == 3 and top.total.bytes == 8
    sub = organize_scan.get_node(dest)
    assert sub.direct.files == 2 and sub.direct.images == 1 and sub.direct.videos == 1
    assert sub.total.bytes == 7


def test_move_to_subfolder_never_overwrites(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "Trip").mkdir()
    (tmp_path / "Trip" / "a.jpg").write_bytes(b"old")
    (tmp_path / "Trip" / "a (1).jpg").write_bytes(b"old1")
    (tmp_path / "a.jpg").write_bytes(b"new")
    res = organize_files.move_to_subfolder(root, root, [os.path.join(root, "a.jpg")], "Trip")
    assert res["failed"] == []
    assert (tmp_path / "Trip" / "a.jpg").read_bytes() == b"old"
    assert (tmp_path / "Trip" / "a (1).jpg").read_bytes() == b"old1"
    assert (tmp_path / "Trip" / "a (2).jpg").read_bytes() == b"new"


@pytest.mark.parametrize("name", ["", "  ", "a/b", "..", ".", ".hidden", "a\x00b", "x" * 300])
def test_move_to_subfolder_rejects_bad_names(tmp_path, name):
    root = str(tmp_path.resolve())
    (tmp_path / "a.jpg").write_bytes(b"x")
    with pytest.raises(InvalidPath):
        organize_files.move_to_subfolder(root, root, [os.path.join(root, "a.jpg")], name)
    assert (tmp_path / "a.jpg").exists()


def test_move_to_subfolder_refusals_are_per_file_and_create_nothing(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "deep.jpg").write_bytes(b"x")
    (tmp_path / "real.jpg").write_bytes(b"x")
    (tmp_path / "link.jpg").symlink_to(tmp_path / "real.jpg")
    res = organize_files.move_to_subfolder(
        root,
        root,
        [
            os.path.join(root, "link.jpg"),
            os.path.join(root, "other", "deep.jpg"),  # not a direct file of the folder
            os.path.join(root, "gone.jpg"),
            os.path.join(root, "other"),  # a folder
        ],
        "New",
    )
    assert res["moved"] == []
    assert len(res["failed"]) == 4
    assert not (tmp_path / "New").exists()  # nothing moved -> no folder created
    assert (tmp_path / "real.jpg").exists() and (tmp_path / "other" / "deep.jpg").exists()


def test_move_to_subfolder_name_taken_by_a_file(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "Trip").write_bytes(b"x")
    (tmp_path / "a.jpg").write_bytes(b"x")
    with pytest.raises(InvalidPath):
        organize_files.move_to_subfolder(root, root, [os.path.join(root, "a.jpg")], "Trip")


def test_clear_thumbnail_cache_wipes_only_cache_entries(tmp_path, thumb_dir):
    img = tmp_path / "a.png"
    _png(img)
    t = organize_files.thumbnail_for(str(img))
    assert t and os.path.exists(t)
    marker = thumb_dir / ("f" * 40 + ".jpg.failed")
    marker.write_bytes(b"")
    stray = thumb_dir / "notes.txt"
    stray.write_bytes(b"x")
    assert organize_files.clear_thumbnail_cache() == 2
    assert not os.path.exists(t) and not marker.exists()
    assert stray.exists() and img.exists()
    assert organize_files.clear_thumbnail_cache() == 0  # nothing left; idempotent


def test_orphan_sweep_removes_stale_failed_markers(tmp_path, db, monkeypatch):
    from app import config, main
    from app.models.file import File
    from app.models.library import Library

    lib = Library(name="L", path=str(tmp_path))
    db.add(lib)
    db.flush()
    live = File(library_id=lib.id, path=str(tmp_path / "v.mp4"), filename="v.mp4")
    db.add(live)
    db.commit()
    d = tmp_path / "thumbnails"
    d.mkdir()
    monkeypatch.setattr(config, "THUMBNAILS_DIR", str(d))
    monkeypatch.setattr("app.database.SessionLocal", lambda: db)  # the sweep opens its own
    for name in (
        f"{live.id}.jpg",
        f"{live.id}.jpg.failed",
        "99999.jpg",
        "99999.jpg.failed",
        "readme.txt",
    ):
        (d / name).write_bytes(b"")
    main._sweep_orphaned_thumbnails()
    assert sorted(os.listdir(d)) == sorted(
        [f"{live.id}.jpg", f"{live.id}.jpg.failed", "readme.txt"]
    )


def test_move_to_subfolder_outside_root(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "x.jpg").write_bytes(b"x")
    with pytest.raises(OutsideRoot):
        organize_files.move_to_subfolder(
            str(root.resolve()), str(tmp_path.resolve()), [str(tmp_path / "x.jpg")], "S"
        )


def test_move_to_folder_moves_between_folders_and_updates_totals(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "a" / "deep").mkdir(parents=True)
    (tmp_path / "b").mkdir()
    (tmp_path / "a" / "x.jpg").write_bytes(b"xx")
    (tmp_path / "a" / "deep" / "y.mp4").write_bytes(b"y" * 4)
    scan(root)
    a, b = os.path.join(root, "a"), os.path.join(root, "b")
    res = organize_files.move_to_folder(root, a, [os.path.join(a, "x.jpg")], b)
    assert res["folder"] == b and res["failed"] == []
    assert (tmp_path / "b" / "x.jpg").exists() and not (tmp_path / "a" / "x.jpg").exists()
    assert organize_scan.get_node(a).direct.files == 0
    assert organize_scan.get_node(a).total.files == 1
    assert (
        organize_scan.get_node(b).direct.images == 1 and organize_scan.get_node(b).total.bytes == 2
    )
    assert organize_scan.get_node(root).total.files == 2  # common ancestor unchanged


def test_move_to_folder_into_a_descendant_and_collision(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "a" / "deep").mkdir(parents=True)
    (tmp_path / "a" / "x.jpg").write_bytes(b"new")
    (tmp_path / "a" / "deep" / "x.jpg").write_bytes(b"old")
    scan(root)
    a, deep = os.path.join(root, "a"), os.path.join(root, "a", "deep")
    organize_files.move_to_folder(root, a, [os.path.join(a, "x.jpg")], deep)
    assert (tmp_path / "a" / "deep" / "x.jpg").read_bytes() == b"old"
    assert (tmp_path / "a" / "deep" / "x (1).jpg").read_bytes() == b"new"
    assert organize_scan.get_node(a).total.files == 2
    assert organize_scan.get_node(deep).direct.files == 2


def test_move_to_folder_refuses_same_folder_missing_and_outside(tmp_path):
    root = tmp_path / "root"
    (root / "a").mkdir(parents=True)
    (root / "a" / "x.jpg").write_bytes(b"x")
    r, a = str(root.resolve()), str((root / "a").resolve())
    with pytest.raises(InvalidPath):
        organize_files.move_to_folder(r, a, [os.path.join(a, "x.jpg")], a)
    with pytest.raises(PathNotFound):
        organize_files.move_to_folder(r, a, [os.path.join(a, "x.jpg")], os.path.join(r, "nope"))
    with pytest.raises(OutsideRoot):
        organize_files.move_to_folder(r, a, [os.path.join(a, "x.jpg")], str(tmp_path.resolve()))
    assert (root / "a" / "x.jpg").exists()


def test_rename_files_renames_never_overwrites_and_recounts_kind(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "a.jpg").write_bytes(b"xx")
    (tmp_path / "b.jpg").write_bytes(b"x")
    (tmp_path / "taken.jpg").write_bytes(b"t")
    scan(root)
    p = lambda n: os.path.join(root, n)  # noqa: E731
    res = organize_files.rename_files(
        root,
        root,
        [
            (p("a.jpg"), "a.txt"),
            (p("b.jpg"), "taken.jpg"),
            (p("gone.jpg"), "z.jpg"),
            (p("a.jpg"), "dup"),
        ],
    )
    assert res["renamed"] == [{"path": p("a.jpg"), "new_path": p("a.txt")}]
    assert {f["path"] for f in res["failed"]} == {p("b.jpg"), p("gone.jpg")}
    assert (tmp_path / "a.txt").read_bytes() == b"xx" and (tmp_path / "b.jpg").exists()
    top = organize_scan.get_node(root)
    assert top.direct.images == 2 and top.direct.other == 1 and top.total.files == 4 - 1


@pytest.mark.parametrize("name", ["", "a/b", "..", ".hidden", "x" * 300])
def test_rename_files_rejects_bad_names_per_item(tmp_path, name):
    root = str(tmp_path.resolve())
    (tmp_path / "a.jpg").write_bytes(b"x")
    res = organize_files.rename_files(root, root, [(os.path.join(root, "a.jpg"), name)])
    assert res["renamed"] == [] and len(res["failed"]) == 1
    assert (tmp_path / "a.jpg").exists()


def test_rename_files_refuses_links_and_other_folders(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "in.jpg").write_bytes(b"x")
    (tmp_path / "real.jpg").write_bytes(b"x")
    (tmp_path / "link.jpg").symlink_to(tmp_path / "real.jpg")
    res = organize_files.rename_files(
        root,
        root,
        [
            (os.path.join(root, "link.jpg"), "l2.jpg"),
            (os.path.join(root, "sub", "in.jpg"), "i2.jpg"),
        ],
    )
    assert res["renamed"] == [] and len(res["failed"]) == 2


def test_rename_folder_repaths_the_cached_subtree(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "old" / "inner").mkdir(parents=True)
    (tmp_path / "old" / "inner" / "x.jpg").write_bytes(b"x")
    scan(root)
    new = organize_files.rename_folder(root, os.path.join(root, "old"), "new")
    assert new == os.path.join(root, "new") and (tmp_path / "new" / "inner" / "x.jpg").exists()
    assert organize_scan.get_node(os.path.join(root, "old")) is None
    inner = organize_scan.get_node(os.path.join(root, "new", "inner"))
    assert inner is not None and inner.direct.files == 1
    assert organize_scan.get_node(root).total.files == 1


def test_rename_folder_refusals(tmp_path):
    root = str(tmp_path.resolve())
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    (tmp_path / "f.txt").write_bytes(b"x")
    for target, name in [
        (root, "x"),
        (os.path.join(root, "a"), "b"),
        (os.path.join(root, "a"), "f.txt"),
        (os.path.join(root, "a"), "a"),
        (os.path.join(root, "a"), "../z"),
        (os.path.join(root, "f.txt"), "z"),
    ]:
        with pytest.raises(InvalidPath):
            organize_files.rename_folder(root, target, name)
    with pytest.raises(OutsideRoot):
        organize_files.rename_folder(root, str(tmp_path.parent), "z")
