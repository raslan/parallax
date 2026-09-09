import time

from app.services import stream_cache as sc


def _seed(tmp_path, age_seconds: float = 0.0):
    """Point the cache at tmp files and create a fake remux + marker."""
    cache = tmp_path / "current.mp4"
    marker = tmp_path / "current.json"
    cache.write_bytes(b"x" * 16)
    marker.write_text('{"path": "/gone.mkv"}')
    if age_seconds:
        old = time.time() - age_seconds
        import os

        os.utime(cache, (old, old))
    return cache, marker


def test_start_sweeper_clears_leftover_unconditionally(tmp_path, monkeypatch):
    cache, marker = _seed(tmp_path, age_seconds=0.0)  # brand new, would survive an idle check
    monkeypatch.setattr(sc, "_CACHE_FILE", str(cache))
    monkeypatch.setattr(sc, "_MARKER_FILE", str(marker))
    monkeypatch.setattr(sc, "_sweeper_thread", None)
    try:
        sc.start_sweeper()
        assert not cache.exists()
        assert not marker.exists()
    finally:
        sc.stop_sweeper()


def test_sweep_idle_locked_respects_ttl(tmp_path, monkeypatch):
    cache, marker = _seed(tmp_path, age_seconds=sc._IDLE_TTL_SECONDS - 60)
    monkeypatch.setattr(sc, "_CACHE_FILE", str(cache))
    monkeypatch.setattr(sc, "_MARKER_FILE", str(marker))
    monkeypatch.setattr(
        sc, "_state", {"path": None, "status": "idle", "progress": 0.0, "error": None}
    )

    sc._sweep_idle_locked()
    assert cache.exists()  # still within TTL

    old = time.time() - (sc._IDLE_TTL_SECONDS + 60)
    import os

    os.utime(cache, (old, old))
    sc._sweep_idle_locked()
    assert not cache.exists()  # past TTL


def test_sweep_idle_locked_skips_while_running(tmp_path, monkeypatch):
    cache, marker = _seed(tmp_path, age_seconds=sc._IDLE_TTL_SECONDS + 3600)
    monkeypatch.setattr(sc, "_CACHE_FILE", str(cache))
    monkeypatch.setattr(sc, "_MARKER_FILE", str(marker))
    monkeypatch.setattr(
        sc, "_state", {"path": "/x.mkv", "status": "running", "progress": 10.0, "error": None}
    )
    sc._sweep_idle_locked()
    assert cache.exists()  # a live remux is never yanked out from under a viewer
