import pytest

from app.services import upscale_plan as plan


def test_plan_tiles_exact_multiple():
    assert plan.plan_tiles(192, 384) == [(0, 0), (0, 192)]


def test_plan_tiles_partial_edges():
    assert plan.plan_tiles(17, 193) == [(0, 0), (0, 192)]
    assert plan.plan_tiles(1, 1) == [(0, 0)]
    assert plan.plan_tiles(10, 10) == [(0, 0)]


def test_plan_tiles_row_major():
    assert plan.plan_tiles(200, 200) == [(0, 0), (0, 192), (192, 0), (192, 192)]


def test_output_size_scales():
    assert plan.output_size(800, 600, 4, 4) == (3200, 2400)
    assert plan.output_size(800, 600, 4, 2) == (1600, 1200)
    assert plan.output_size(800, 600, 4, 1) == (800, 600)
    with pytest.raises(ValueError):
        plan.output_size(800, 600, 2, 4)


def test_skip_reason_cap():
    # 4000x3000 = 12 MP: x4 -> 192 MP (over), x2 -> 48 MP (fine)
    assert "150 MP" in plan.skip_reason("/a/p.jpg", 4000, 3000, 4)
    assert plan.skip_reason("/a/p.jpg", 4000, 3000, 2) is None


def test_skip_reason_cap_boundary():
    # exactly 150 MP is allowed: 15000 x 10000
    assert plan.skip_reason("/a/p.png", 15000, 10000, 1) is None
    assert plan.skip_reason("/a/p.png", 15000, 10001, 1) is not None


@pytest.mark.parametrize("name", ["/a/p.gif", "/a/p.heic", "/a/p.bmp", "/a/p"])
def test_skip_reason_extension(name):
    assert plan.skip_reason(name, 10, 10, 2) == "format not supported"


@pytest.mark.parametrize("name", ["/a/p.JPG", "/a/p.jpeg", "/a/p.png", "/a/p.WebP"])
def test_supported_extensions_any_case(name):
    assert plan.skip_reason(name, 10, 10, 2) is None


def test_skip_reason_unknown_dims_ok():
    assert plan.skip_reason("/a/p.jpg", None, None, 4) is None
    assert plan.skip_reason("/a/p.jpg", 100, None, 4) is None


def test_output_path_names():
    assert plan.output_path("/a/p.jpg", 2, exists=lambda _: False) == "/a/p_2x.jpg"
    taken = {"/a/p_2x.jpg"}
    assert plan.output_path("/a/p.jpg", 2, exists=taken.__contains__) == "/a/p_2x_1.jpg"
    taken.add("/a/p_2x_1.jpg")
    assert plan.output_path("/a/p.jpg", 2, exists=taken.__contains__) == "/a/p_2x_2.jpg"


def test_output_path_keeps_extension_case():
    assert plan.output_path("/a/P.JPG", 1, exists=lambda _: False) == "/a/P_1x.JPG"
