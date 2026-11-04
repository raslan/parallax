import numpy as np
import pytest
from PIL import Image

from app.services import upscale_image_io as io


def _orientation(exif_bytes: bytes | None) -> int | None:
    if not exif_bytes:
        return None
    ex = Image.Exif()
    ex.load(exif_bytes)
    return ex.get(0x0112)


def test_orientation_baked_in(tmp_path):
    img = Image.new("RGB", (40, 20), (200, 10, 10))
    ex = Image.Exif()
    ex[0x0112] = 6  # rotate 90 CW to display
    p = tmp_path / "rot.jpg"
    img.save(p, exif=ex.tobytes())

    loaded = io.load_image(str(p))

    assert loaded.rgb.shape == (40, 20, 3)  # now portrait: 20 wide, 40 tall
    assert _orientation(loaded.exif) in (None, 1)

    # Saving and reopening must not rotate it a second time.
    out = tmp_path / "out.jpg"
    io.save_image(str(out), loaded.rgb, loaded)
    reopened = Image.open(out)
    from PIL import ImageOps

    assert ImageOps.exif_transpose(reopened).size == (20, 40)


def test_png_alpha_roundtrip(tmp_path):
    rgba = np.zeros((20, 30, 4), dtype=np.uint8)
    rgba[:, :, :3] = (10, 120, 200)
    rgba[:, :15, 3] = 255  # left half opaque, right half transparent
    p = tmp_path / "a.png"
    Image.fromarray(rgba, "RGBA").save(p)

    loaded = io.load_image(str(p))
    assert loaded.alpha is not None and loaded.fmt == "PNG"
    assert loaded.rgb.shape == (20, 30, 3)

    big = np.repeat(np.repeat(loaded.rgb, 2, axis=0), 2, axis=1)
    out = tmp_path / "out.png"
    io.save_image(str(out), big, loaded)
    res = Image.open(out)
    assert res.mode == "RGBA" and res.size == (60, 40)
    a = np.array(res)[:, :, 3]
    assert a[20, 5] == 255 and a[20, 55] == 0


def test_palette_and_gray_convert(tmp_path):
    pal = Image.new("P", (8, 8))
    pal.putpalette([255, 0, 0] * 256)
    pal.save(tmp_path / "p.png")
    Image.new("L", (8, 8), 100).save(tmp_path / "l.png")
    for name in ("p.png", "l.png"):
        loaded = io.load_image(str(tmp_path / name))
        assert loaded.rgb.dtype == np.uint8 and loaded.rgb.shape == (8, 8, 3)
        assert loaded.alpha is None


def test_palette_with_transparency_keeps_alpha(tmp_path):
    pal = Image.new("P", (8, 8), 0)
    pal.putpalette([255, 0, 0] * 256)
    pal.save(tmp_path / "pt.png", transparency=0)
    loaded = io.load_image(str(tmp_path / "pt.png"))
    assert loaded.alpha is not None


def test_unsupported_modes_raise(tmp_path):
    Image.new("CMYK", (8, 8)).save(tmp_path / "c.jpg")
    Image.new("I;16", (8, 8)).save(tmp_path / "g16.png")
    frames = [Image.new("RGB", (8, 8), c) for c in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(tmp_path / "anim.webp", save_all=True, append_images=frames[1:], duration=100)
    for name in ("c.jpg", "g16.png", "anim.webp"):
        with pytest.raises(io.UnsupportedImage):
            io.load_image(str(tmp_path / name))


def test_corrupt_file_raises(tmp_path):
    (tmp_path / "bad.jpg").write_bytes(b"\xff\xd8\xff\xe0 not really a jpeg")
    (tmp_path / "gone.jpg").write_bytes(b"")
    for name in ("bad.jpg", "gone.jpg", "missing.jpg"):
        with pytest.raises(io.UnsupportedImage, match="could not read"):
            io.load_image(str(tmp_path / name))


def test_truncated_jpeg_raises(tmp_path):
    p = tmp_path / "t.jpg"
    Image.effect_noise((200, 200), 80).convert("RGB").save(p)
    p.write_bytes(p.read_bytes()[:400])
    with pytest.raises(io.UnsupportedImage):
        io.load_image(str(p))


def test_icc_and_exif_preserved_jpeg(tmp_path):
    from PIL import ImageCms

    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    ex = Image.Exif()
    ex[0x010F] = "ParallaxCam"
    p = tmp_path / "c.jpg"
    Image.new("RGB", (16, 16), (1, 2, 3)).save(p, exif=ex.tobytes(), icc_profile=icc)

    loaded = io.load_image(str(p))
    assert loaded.icc == icc
    out = tmp_path / "o.jpg"
    io.save_image(str(out), loaded.rgb, loaded)
    res = Image.open(out)
    assert res.info["icc_profile"] == icc
    assert res.getexif().get(0x010F) == "ParallaxCam"


@pytest.mark.parametrize("ext,fmt", [("jpg", "JPEG"), ("png", "PNG"), ("webp", "WEBP")])
def test_formats_roundtrip(tmp_path, ext, fmt):
    p = tmp_path / f"f.{ext}"
    Image.new("RGB", (12, 9), (50, 60, 70)).save(p)
    loaded = io.load_image(str(p))
    assert loaded.fmt == fmt
    big = np.zeros((18, 24, 3), dtype=np.uint8)
    # Real callers pass a temp name that doesn't end in the format's extension.
    out = tmp_path / f"f_2x.compressing-1{'.' + ext}"
    io.save_image(str(out), big, loaded)
    res = Image.open(out)
    assert res.format == fmt and res.size == (24, 18)


def test_mpo_phone_jpeg_is_treated_as_jpeg(tmp_path):
    a = Image.new("RGB", (16, 12), (9, 9, 9))
    p = tmp_path / "phone.jpg"
    a.save(p, format="MPO", save_all=True, append_images=[Image.new("RGB", (16, 12))])
    assert Image.open(p).format == "MPO"
    loaded = io.load_image(str(p))
    assert loaded.fmt == "JPEG" and loaded.rgb.shape == (12, 16, 3)


def test_gray_icc_profile_not_attached_to_rgb_output(tmp_path):
    from PIL import ImageCms

    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    p = tmp_path / "gray.png"
    Image.new("L", (8, 8), 90).save(p, icc_profile=icc)
    loaded = io.load_image(str(p))
    assert loaded.icc is None  # the output is RGB; a Gray profile would mismatch it


def test_colour_key_transparency_becomes_alpha(tmp_path):
    arr = np.zeros((10, 20, 3), dtype=np.uint8)
    arr[:, :10] = (10, 20, 30)  # keyed colour
    arr[:, 10:] = (200, 100, 50)
    p = tmp_path / "key.png"
    Image.fromarray(arr, "RGB").save(p, transparency=(10, 20, 30))
    loaded = io.load_image(str(p))
    assert loaded.alpha is not None
    a = np.asarray(loaded.alpha)
    assert a[5, 2] == 0 and a[5, 15] == 255


def test_webp_alpha_roundtrip(tmp_path):
    rgba = np.zeros((20, 30, 4), dtype=np.uint8)
    rgba[:, :, :3] = (10, 120, 200)
    rgba[:, :15, 3] = 255
    p = tmp_path / "a.webp"
    Image.fromarray(rgba, "RGBA").save(p, lossless=True)
    loaded = io.load_image(str(p))
    assert loaded.alpha is not None and loaded.fmt == "WEBP"
    big = np.repeat(np.repeat(loaded.rgb, 2, axis=0), 2, axis=1)
    out = tmp_path / "o.webp"
    io.save_image(str(out), big, loaded)
    res = Image.open(out)
    assert res.mode == "RGBA" and res.size == (60, 40)
    a = np.array(res)[:, :, 3]
    assert a[20, 5] > 200 and a[20, 55] < 50
