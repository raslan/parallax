"""The download cache: raw candidate downloads, kept an hour so a season pack is fetched once."""

import os
import time

import pytest

from app.services import subtitle_downloads as dl


@pytest.fixture(autouse=True)
def folder(tmp_path, monkeypatch):
    d = tmp_path / "subtitle-downloads"
    monkeypatch.setattr(dl, "DOWNLOADS_DIR", str(d))
    return d


def test_put_then_get_returns_the_same_bytes():
    dl.put("subf2m", "/subtitles/x/y/1", b"raw archive bytes")
    assert dl.get("subf2m", "/subtitles/x/y/1") == b"raw archive bytes"


def test_get_of_an_unknown_id_is_none():
    assert dl.get("subf2m", "/nope") is None


def test_the_source_is_part_of_the_key():
    dl.put("subf2m", "same", b"a")
    dl.put("yts", "same", b"b")
    assert dl.get("subf2m", "same") == b"a" and dl.get("yts", "same") == b"b"


def test_a_failed_write_leaves_the_previous_file_and_no_temp(folder, monkeypatch):
    dl.put("subf2m", "id", b"first")

    real_replace = os.replace

    def broken(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(dl.os, "replace", broken)
    dl.put("subf2m", "id", b"second")  # a cache that cannot write never fails the download
    monkeypatch.setattr(dl.os, "replace", real_replace)
    assert dl.get("subf2m", "id") == b"first"
    assert not [n for n in os.listdir(folder) if n.endswith(".tmp")]


def test_an_id_cannot_escape_the_folder(folder, tmp_path):
    hostile = "../../../etc/evil"
    dl.put("subf2m", hostile, b"x")
    assert dl.get("subf2m", hostile) == b"x"
    inside = {os.path.realpath(os.path.join(folder, n)) for n in os.listdir(folder)}
    assert all(p.startswith(os.path.realpath(folder) + os.sep) for p in inside)
    assert not (tmp_path / "etc").exists()
    dl.put("../evil", "id", b"y")  # nor can the source name
    assert all(
        os.path.dirname(os.path.realpath(os.path.join(folder, n))) == os.path.realpath(folder)
        for n in os.listdir(folder)
    )


def test_empty_bytes_are_not_cached():
    dl.put("subf2m", "id", b"")
    assert dl.get("subf2m", "id") is None


def test_sweep_removes_old_files_and_keeps_fresh_ones(folder):
    dl.put("subf2m", "old", b"o")
    dl.put("subf2m", "new", b"n")
    old = os.path.join(folder, os.listdir(folder)[0])
    os.utime(old, (time.time() - 7200, time.time() - 7200))
    kept = {n for n in os.listdir(folder) if os.path.join(folder, n) != old}
    assert dl.sweep(3600) == 1
    assert set(os.listdir(folder)) == kept
    assert dl.sweep(0) == 1
    assert os.listdir(folder) == []


def test_sweep_of_a_missing_folder_is_zero():
    assert dl.sweep() == 0


def test_fetch_cached_fetches_once_then_reads_the_cache():
    calls = []

    class P:
        def fetch(self, subtitle_id):
            calls.append(subtitle_id)
            return b"pack"

    assert dl.fetch_cached(P(), "subf2m", "id") == b"pack"
    assert dl.fetch_cached(P(), "subf2m", "id") == b"pack"
    assert calls == ["id"]
