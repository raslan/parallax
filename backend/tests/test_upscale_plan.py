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


def test_prescaled_size_percent_rounds_half_up_and_never_zero():
    assert plan.prescaled_size(1000, 800, 100) == (1000, 800)  # 100 = off
    assert plan.prescaled_size(1000, 800, 75) == (750, 600)
    assert plan.prescaled_size(1310, 1756, 75) == (983, 1317)  # 982.5 -> 983, 1317.0
    assert plan.prescaled_size(1000, 500, 33) == (330, 165)  # 165.0
    assert plan.prescaled_size(3, 2, 10) == (1, 1)  # never below 1 px


def test_output_size_with_prescale_runs_model_at_native():
    # 75% of 1310x1756 -> 983x1317, then the 4x model
    assert plan.output_size(1310, 1756, 4, 4, prescale=75) == (3932, 5268)
    # 25% with the 4x model gives back about the original size
    assert plan.output_size(4000, 3000, 4, 4, prescale=25) == (4000, 3000)
    # 50% with a 2x model
    assert plan.output_size(801, 601, 2, 2, prescale=50) == (802, 602)  # 400.5 -> 401, 300.5 -> 301


def test_output_size_prescale_requires_native_scale():
    with pytest.raises(ValueError):
        plan.output_size(800, 600, 4, 2, prescale=50)


def test_output_size_prescale_100_is_the_plain_scale():
    assert plan.output_size(800, 600, 4, 2, prescale=100) == (1600, 1200)


def test_skip_reason_cap_accounts_for_prescale():
    # 12 MP x4 is over the cap, but at 25% first (then x4) it is the original size
    assert "150 MP" in plan.skip_reason("/a/p.jpg", 4000, 3000, 4)
    assert plan.skip_reason("/a/p.jpg", 4000, 3000, 4, prescale=25) is None
    # 50% then the 4x model = 2x the source per side: 12 MP -> 48 MP, fine
    assert plan.skip_reason("/a/p.jpg", 4000, 3000, 4, prescale=50) is None
    assert "150 MP" in plan.skip_reason("/a/p.jpg", 9000, 6000, 4, prescale=75)


def test_output_path_prescale_tag():
    assert plan.output_path("/a/p.jpg", 4, exists=lambda _: False, prescale=75) == "/a/p_p75_4x.jpg"
    taken = {"/a/p_p75_4x.jpg"}
    assert (
        plan.output_path("/a/p.jpg", 4, exists=taken.__contains__, prescale=75)
        == "/a/p_p75_4x_1.jpg"
    )
    # 100 means "not pre-scaled": the plain name
    assert plan.output_path("/a/p.jpg", 2, exists=lambda _: False, prescale=100) == "/a/p_2x.jpg"
