"""Image load/save for upscaling: orientation, alpha, EXIF/ICC handling.

`load_image` yields an upright uint8 RGB array (plus a separate alpha plane when the source has
one); `save_image` writes the upscaled array back in the source's format.
"""

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

_ORIENTATION_TAG = 0x0112
_FORMATS = {"JPEG", "PNG", "WEBP"}
_ALPHA_MODES = {"RGBA", "LA", "PA"}
_RGB_CONVERTIBLE = {"RGB", "L", "P", "1"} | _ALPHA_MODES


class UnsupportedImage(Exception):
    """The image can't be upscaled; the message is the user-facing reason."""


@dataclass
class LoadedImage:
    rgb: np.ndarray  # uint8 HxWx3, already upright
    alpha: Image.Image | None  # mode "L", upright
    exif: bytes | None
    icc: bytes | None
    fmt: str  # "JPEG" | "PNG" | "WEBP"


def load_image(path: str) -> LoadedImage:
    try:
        return _load(path)
    except UnsupportedImage:
        raise
    except Exception as exc:  # corrupt/truncated/bomb/permission: never crash the batch
        raise UnsupportedImage("could not read image") from exc


def _load(path: str) -> LoadedImage:
    with Image.open(path) as img:
        fmt = img.format
        # Phone JPEGs with a second embedded picture open as MPO; only frame 0 is used.
        if fmt == "MPO":
            fmt = "JPEG"
        elif getattr(img, "n_frames", 1) > 1:
            raise UnsupportedImage("animated images are not supported")
        if fmt not in _FORMATS:
            raise UnsupportedImage("format not supported")
        icc = img.info.get("icc_profile")
        img.load()
        upright = ImageOps.exif_transpose(img)

    if upright.mode not in _RGB_CONVERTIBLE:
        raise UnsupportedImage(f"unsupported image mode {upright.mode}")

    exif = upright.getexif()
    exif.pop(_ORIENTATION_TAG, None)  # baked into the pixels below; must not rotate twice
    exif_bytes = exif.tobytes() if len(exif) else None

    if upright.mode == "P" and "transparency" in upright.info:
        upright = upright.convert("RGBA")
    alpha = None
    if upright.mode in _ALPHA_MODES:
        alpha = upright.getchannel("A")
    rgb = np.asarray(upright.convert("RGB"), dtype=np.uint8)
    return LoadedImage(rgb=rgb, alpha=alpha, exif=exif_bytes, icc=icc, fmt=fmt)


def save_image(path: str, rgb: np.ndarray, loaded: LoadedImage) -> None:
    """Encode `rgb` in the source's format at `path` (the caller passes the temp path)."""
    out = Image.fromarray(rgb, "RGB")
    if loaded.alpha is not None and loaded.fmt in ("PNG", "WEBP"):
        out.putalpha(loaded.alpha.resize(out.size, Image.Resampling.LANCZOS))

    kwargs: dict = {}
    if loaded.exif:
        kwargs["exif"] = loaded.exif
    if loaded.icc:
        kwargs["icc_profile"] = loaded.icc
    if loaded.fmt == "JPEG":
        kwargs.update(quality=95, subsampling=0)
    elif loaded.fmt == "WEBP":
        kwargs.update(quality=95)
    out.save(path, format=loaded.fmt, **kwargs)
