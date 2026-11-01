"""Sandboxed HLS prepare for Prune (route functions called directly: no slow client)."""

import shutil

import pytest
from fastapi import HTTPException

from app.api import prune as api
from app.models.settings import set_setting
from app.schemas import PruneStreamBody
from app.services import stream_cache
from app.services.prune_sandbox import SandboxError

_RUNNING = {"status": "running", "progress": 0.0, "error": None, "mode": "hls", "url": None}


@pytest.fixture
def calls(monkeypatch):
    seen: list[tuple[str, str]] = []

    def record(kind):
        return lambda p: seen.append((kind, p)) or _RUNNING

    monkeypatch.setattr(stream_cache, "start_prepare", record("start"))
    monkeypatch.setattr(stream_cache, "needs_prepare", record("poll"))
    return seen


@pytest.fixture
def tree(tmp_path, db):
    root = tmp_path / "root"
    (root / ".hd").mkdir(parents=True)
    (root / "v.mkv").write_bytes(b"x")
    (root / ".h.mkv").write_bytes(b"x")
    (root / ".hd" / "x.mkv").write_bytes(b"x")
    (root / "n.txt").write_bytes(b"x")
    (root / "a.mp3").write_bytes(b"x")
    (root / "ln.mkv").symlink_to(root / "v.mkv")
    (tmp_path / "out.mkv").write_bytes(b"x")
    set_setting(db, "prune_root", str(root.resolve()))
    return root.resolve()


def _both(db, path):
    """Status codes from (prepare, prepare-status) for one path."""
    codes = []
    for call in (
        lambda: api.prune_stream_prepare(PruneStreamBody(path=path), db),
        lambda: api.prune_stream_status(path, db),
    ):
        try:
            call()
            codes.append(200)
        except HTTPException as e:
            codes.append(e.status_code)
        except SandboxError as e:  # mapped by the app-wide handler in a real request
            codes.append(api.sandbox_error_handler(None, e).status_code)
    return tuple(codes)


def test_prepare_and_status_delegate_inside_root(db, tree, calls):
    v = str(tree / "v.mkv")
    assert api.prune_stream_prepare(PruneStreamBody(path=v), db) == _RUNNING
    assert api.prune_stream_status(v, db) == _RUNNING
    assert calls == [("start", v), ("poll", v)]


def test_prepare_refuses_outside_symlink_hidden_and_non_video(db, tree, calls):
    cases = {
        str(tree.parent / "out.mkv"): 403,  # outside the root
        str(tree / ".." / "out.mkv"): 403,
        str(tree / "ln.mkv"): 404,  # final symlink: not a servable file
        str(tree / "ln.mkv") + "/": 404,
        str(tree / ".h.mkv"): 400,  # hidden file
        str(tree / ".hd" / "x.mkv"): 400,  # hidden folder
        str(tree / "missing.mkv"): 404,
        str(tree / "n.txt"): 415,  # only video goes through HLS
        str(tree / "a.mp3"): 415,
        str(tree): 404,  # a folder
        str(tree) + "/v\x00.mkv": 400,
    }
    for path, status in cases.items():
        assert _both(db, path) == (status, status), path
    assert calls == []


def test_prepare_409_when_root_gone_or_unset(db, tree, calls):
    shutil.rmtree(tree)
    assert _both(db, str(tree / "v.mkv")) == (409, 409)
    set_setting(db, "prune_root", "")
    assert _both(db, str(tree / "v.mkv")) == (409, 409)
    assert calls == []
