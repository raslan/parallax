import shutil

import pytest

from app.services import upscale_models as um


def test_list_tiers_order_and_speed():
    tiers = um.list_tiers()
    assert [t.id for t in tiers] == ["fast", "natural"]
    assert [t.speed for t in tiers] == ["fast", "slow"]
    assert [t.scale for t in tiers] == [4, 4]
    assert all(t.hint and t.label and t.size_bytes > 0 for t in tiers)


def test_tiers_describe_their_character():
    by_id = {t.id: t for t in um.list_tiers()}
    # The picker's tooltip is the only place a user learns the difference between the two models.
    assert "default" in by_id["fast"].hint.lower()
    assert "detail" in by_id["natural"].hint.lower()
    assert by_id["fast"].label != by_id["natural"].label


def test_allowed_scales():
    for tier in um.list_tiers():
        assert um.allowed_scales(tier) == (1, 2, 4)


def test_allowed_scales_of_a_2x_model_stop_at_2():
    two_x = um.UpscaleTier("t", "T", "m", 2, "fast", "h", "p", "b", 1)
    assert um.allowed_scales(two_x) == (1, 2)


def test_blob_names_come_from_the_registry():
    # Both bundled models are pre-converted hub files, which use data/output (not pnnx's in0/out0).
    for t in um.list_tiers():
        assert (t.input_blob, t.output_blob) == ("data", "output")


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
    tier = um.get_tier("fast")
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
    tier = um.get_tier("natural")
    (tmp_path / "upscale" / tier.param_path.rsplit("/", 1)[1]).unlink()
    with pytest.raises(um.UpscaleModelError):
        um.verify_tier_files(tier)


def test_credits_has_author_and_ncnn_text():
    c = um.credits()
    assert [m["tier"] for m in c["models"]] == ["fast", "natural"]
    for m in c["models"]:
        assert m["author"] == "Philip Hofmann (Phhofm)"
        assert m["licence"] == "CC-BY-4.0"
        assert m["licence_url"].startswith("https://")
        assert m["release_url"].startswith("https://")
        assert m["note"]
    natural = next(m for m in c["models"] if m["tier"] == "natural")
    assert "pre-converted" in natural["note"] and "Universal-NCNN-Upscaler" in natural["note"]
    fast = next(m for m in c["models"] if m["tier"] == "fast")
    assert fast["name"] == "4xLSDIRCompactC3" and "pre-converted" in fast["note"]
    assert "BSD" in c["ncnn"]["text"]
    assert "Tencent" in c["ncnn"]["copyright"]
