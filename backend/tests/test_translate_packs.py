import hashlib
import os

import pytest

from app.services import translate_packs as tp


def _pack(files: dict[str, bytes]) -> dict:
    return {
        "lang": "xx",
        "name": "Testish",
        "base_url": "https://example.test/rev",
        "files": [
            {"name": n, "size": len(b), "sha256": hashlib.sha256(b).hexdigest()}
            for n, b in files.items()
        ],
    }


def _fetcher(files: dict[str, bytes], chunk: int = 4):
    def fetch(url: str):
        data = files[url.rsplit("/", 1)[1]]
        for i in range(0, len(data), chunk):
            yield data[i : i + chunk]

    return fetch


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(tp, "PACKS_DIR", str(tmp_path / "packs"))
    return tmp_path / "packs"


def test_registry_has_arabic_with_per_file_hashes():
    pack = tp.get_pack("ar")
    assert pack["target_token"] == ">>ara<<"
    assert {f["name"] for f in pack["files"]} >= {"model.bin", "source.spm", "target.spm"}
    assert all(len(f["sha256"]) == 64 and f["size"] > 0 for f in pack["files"])
    assert pack["base_url"].endswith(pack["revision"])
    assert tp.get_pack("zz") is None


def test_install_writes_verified_files_and_marks_installed(root):
    files = {"model.bin": b"0123456789", "source.spm": b"abc"}
    pack = _pack(files)
    assert not tp.is_installed(pack)
    seen = []
    tp.install_pack(pack, _fetcher(files), progress=seen.append, is_cancelled=lambda: False)
    assert tp.is_installed(pack)
    assert (root / "xx" / "model.bin").read_bytes() == b"0123456789"
    assert seen and seen[-1] == 100.0 and seen == sorted(seen)
    assert not [p for p in root.iterdir() if p.name.startswith(".")]  # no staging dir left


def test_hash_mismatch_fails_loudly_and_leaves_nothing(root):
    files = {"model.bin": b"0123456789"}
    pack = _pack(files)
    bad = {"model.bin": b"0123456780"}  # same size, one byte changed
    with pytest.raises(tp.PackError, match="model.bin"):
        tp.install_pack(pack, _fetcher(bad), progress=lambda _p: None, is_cancelled=lambda: False)
    assert not tp.is_installed(pack)
    assert not root.exists() or list(root.iterdir()) == []


def test_cancel_stops_and_leaves_nothing(root):
    files = {"model.bin": b"x" * 100}
    pack = _pack(files)
    calls = {"n": 0}

    def cancelled():
        calls["n"] += 1
        return calls["n"] > 3

    with pytest.raises(tp.PackCancelled):
        tp.install_pack(pack, _fetcher(files), progress=lambda _p: None, is_cancelled=cancelled)
    assert not tp.is_installed(pack)
    assert not root.exists() or list(root.iterdir()) == []


def test_reinstall_replaces_a_damaged_pack(root):
    files = {"model.bin": b"0123456789"}
    pack = _pack(files)
    tp.install_pack(pack, _fetcher(files), progress=lambda _p: None, is_cancelled=lambda: False)
    (root / "xx" / "model.bin").write_bytes(b"short")
    assert not tp.is_installed(pack)  # size no longer matches
    tp.install_pack(pack, _fetcher(files), progress=lambda _p: None, is_cancelled=lambda: False)
    assert tp.is_installed(pack)


def test_remove_deletes_the_pack_folder(root):
    files = {"model.bin": b"0123456789"}
    pack = _pack(files)
    tp.install_pack(pack, _fetcher(files), progress=lambda _p: None, is_cancelled=lambda: False)
    assert tp.remove_pack(pack) is True
    assert not os.path.exists(root / "xx")
    assert tp.remove_pack(pack) is False


def test_installed_size_counts_the_files_on_disk(root):
    files = {"model.bin": b"0123456789", "source.spm": b"abc"}
    pack = _pack(files)
    assert tp.installed_bytes(pack) == 0
    tp.install_pack(pack, _fetcher(files), progress=lambda _p: None, is_cancelled=lambda: False)
    assert tp.installed_bytes(pack) == 13


def test_every_registered_pack_is_pinned_and_was_validated():
    import json
    from pathlib import Path

    fixtures = Path(__file__).resolve().parents[1] / "tools" / "pack_fixtures"
    seen = set()
    for pack in tp.list_packs():
        lang = pack["lang"]
        assert lang not in seen
        seen.add(lang)
        # a pack only enters the registry after tools/validate_pack.py passed it (needs a fixture)
        assert (fixtures / f"{lang}.json").exists(), lang
        fx = json.loads((fixtures / f"{lang}.json").read_text(encoding="utf-8"))
        assert fx.get("target_token") == pack.get("target_token"), lang
        names = {f["name"] for f in pack["files"]}
        assert {"model.bin", "source.spm", "target.spm", "config.json"} <= names, lang
        assert all(len(f["sha256"]) == 64 and f["size"] > 0 for f in pack["files"]), lang
        assert pack["revision"] in pack["base_url"] and pack["base_url"].startswith("https://")
        assert pack["licence"] and pack["licence_url"] and pack["credit_id"] == "opus-mt"
    assert {"ar", "de", "es", "fr", "it", "pt", "ru", "zh"} <= seen


def test_multi_target_models_name_their_language_and_single_target_ones_do_not():
    assert tp.get_pack("pt")["target_token"] == ">>por<<"
    assert tp.get_pack("zh")["target_token"] == ">>cmn_Hans<<"
    for lang in ("de", "es", "fr", "it", "ru"):
        assert "target_token" not in tp.get_pack(lang)
    assert tp.get_pack("ar")["rtl"] is True and tp.get_pack("de")["rtl"] is False
