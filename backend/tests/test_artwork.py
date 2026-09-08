import io

from PIL import Image

from app.services import artwork


def _frame(color=(20, 60, 110)):
    return Image.new("RGB", (1280, 720), color)


def test_title_color_is_a_light_tint_keyed_to_hue():
    r, g, b = artwork._title_color(_frame((10, 40, 120)))  # blue frame
    assert min(r, g, b) > 150  # near-white
    assert b >= r  # keeps a cool cast


def test_cover_crop_hits_exact_dimensions():
    out = artwork._cover(_frame(), 1000, 1500)
    assert out.size == (1000, 1500)


def test_poster_is_a_2x3_jpeg_with_text_rendered():
    data = artwork.build_poster(_frame(), "Some Long Show Title That Must Wrap Across Lines")
    img = Image.open(io.BytesIO(data))
    assert img.format == "JPEG"
    assert img.size == (1000, 1500)
    # the title plate + text lighten some pixels well above the darkened bg
    extrema = img.convert("L").getextrema()
    assert extrema[1] > 180


def test_backdrop_is_16x9_jpeg():
    img = Image.open(io.BytesIO(artwork.build_backdrop(_frame())))
    assert img.format == "JPEG"
    assert img.size == (1920, 1080)


def test_artwork_paths_lists_the_five_files_under_the_show_folder():
    paths = [p for p, _ in artwork.artwork_paths("/media/Show", 2)]
    assert paths == [
        "/media/Show/poster.jpg",
        "/media/Show/folder.jpg",
        "/media/Show/backdrop.jpg",
        "/media/Show/fanart.jpg",
        "/media/Show/Season 02/folder.jpg",
    ]
