import shutil

import pytest

from app.services import upscale_models as um


def test_list_tiers_order_and_speed():
    tiers = um.list_tiers()
    assert [t.id for t in tiers] == ["fast", "sharp", "natural"]
    assert [t.speed for t in tiers] == ["fast", "fast", "slow"]
    assert [t.scale for t in tiers] == [4, 4, 4]
    assert all(t.hint and t.label and t.size_bytes > 0 for t in tiers)


def test_tiers_describe_their_character():
    by_id = {t.id: t for t in um.list_tiers()}
    # The picker's tooltip is the only place a user learns the difference between the two models.
    assert "default" in by_id["fast"].hint.lower()
    assert "crisper" in by_id["sharp"].hint.lower()
    assert "detail" in by_id["natural"].hint.lower()
    assert len({t.label for t in by_id.values()}) == 3


def test_allowed_scales():
    for tier in um.list_tiers():
        assert um.allowed_scales(tier) == (1, 2, 4)


def test_allowed_scales_of_a_2x_model_stop_at_2():
    two_x = um.UpscaleTier("t", "T", "m", 2, "fast", "h", "p", "b", 1)
    assert um.allowed_scales(two_x) == (1, 2)


def test_blob_names_come_from_the_registry():
    # The hub-converted files use data/output; NERVE's own ncnn export uses pnnx's in0/out0.
    by_id = {t.id: t for t in um.list_tiers()}
    assert (by_id["fast"].input_blob, by_id["fast"].output_blob) == ("data", "output")
    assert (by_id["natural"].input_blob, by_id["natural"].output_blob) == ("data", "output")
    assert (by_id["sharp"].input_blob, by_id["sharp"].output_blob) == ("in0", "out0")


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
