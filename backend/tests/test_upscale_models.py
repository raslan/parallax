import shutil

import pytest

from app.services import upscale_models as um


def test_list_tiers_order_and_speed():
    tiers = um.list_tiers()
    assert [t.id for t in tiers] == ["simple", "sharp", "natural", "detailed"]
    assert [t.speed for t in tiers] == ["fast", "fast", "slow", "slow"]
    assert [t.scale for t in tiers] == [2, 2, 4, 4]
    assert all(t.hint and t.label and t.size_bytes > 0 for t in tiers)


def test_tiers_describe_their_character():
    by_id = {t.id: t for t in um.list_tiers()}
    # The picker's tooltip is the only place a user learns the difference between the two 4x models.
    assert "invent" in by_id["detailed"].hint.lower()
    assert "natural" in by_id["natural"].hint.lower() or "clean" in by_id["natural"].hint.lower()
    assert by_id["natural"].label != by_id["detailed"].label


def test_allowed_scales():
    simple, sharp, natural, detailed = um.list_tiers()
    assert um.allowed_scales(simple) == (1, 2)
    assert um.allowed_scales(sharp) == (1, 2)
    assert um.allowed_scales(natural) == (1, 2, 4)
    assert um.allowed_scales(detailed) == (1, 2, 4)


def test_blob_names_come_from_the_registry():
    # pnnx output uses in0/out0; the pre-converted Nomos8kSC file uses data/output.
    by_id = {t.id: t for t in um.list_tiers()}
    assert (by_id["simple"].input_blob, by_id["simple"].output_blob) == ("in0", "out0")
    assert (by_id["detailed"].input_blob, by_id["detailed"].output_blob) == ("in0", "out0")
    assert (by_id["natural"].input_blob, by_id["natural"].output_blob) == ("data", "output")


def test_get_tier_unknown_raises():
    with pytest.raises(um.UpscaleModelError):
        um.get_tier("ultra")


def test_verify_real_files_pass():
    for t in um.list_tiers():
        um.verify_tier_files(t)


def test_verify_detects_corruption(tmp_path, monkeypatch):
    copy = tmp_path / "upscale"
    shutil.copytree(um.ASSETS_DIR, copy)
    monkeypatch.setattr(um, "ASSETS_DIR", copy)
    monkeypatch.setattr(um, "_verified", set())
    tier = um.get_tier("simple")
    bin_file = copy / tier.bin_path.rsplit("/", 1)[1]
    data = bytearray(bin_file.read_bytes())
    data[100] ^= 0xFF
    bin_file.write_bytes(bytes(data))
    with pytest.raises(um.UpscaleModelError):
        um.verify_tier_files(tier)


def test_verify_missing_file_raises(tmp_path, monkeypatch):
    shutil.copytree(um.ASSETS_DIR, tmp_path / "upscale")
    monkeypatch.setattr(um, "ASSETS_DIR", tmp_path / "upscale")
    monkeypatch.setattr(um, "_verified", set())
    tier = um.get_tier("sharp")
    (tmp_path / "upscale" / tier.param_path.rsplit("/", 1)[1]).unlink()
    with pytest.raises(um.UpscaleModelError):
        um.verify_tier_files(tier)


def test_credits_has_author_and_ncnn_text():
    c = um.credits()
    assert len(c["models"]) == 4
    for m in c["models"]:
        assert m["author"] == "Philip Hofmann (Phhofm)"
        assert m["licence"] == "CC-BY-4.0"
        assert m["licence_url"].startswith("https://")
        assert m["release_url"].startswith("https://")
        assert m["note"]
    natural = next(m for m in c["models"] if m["tier"] == "natural")
    assert "pre-converted" in natural["note"] and "Universal-NCNN-Upscaler" in natural["note"]
    assert "BSD" in c["ncnn"]["text"]
    assert "Tencent" in c["ncnn"]["copyright"]
