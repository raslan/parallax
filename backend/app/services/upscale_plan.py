"""Pure planning helpers for image upscaling: tile grid, output size, skip rules, output naming.

No image or model IO here (only the injected `exists` for naming), so everything is unit-testable.
"""

import os
from collections.abc import Callable

TILE = 192  # source pixels kept per tile
PAD = 16  # reflect padding on each side; the model sees TILE + 2 * PAD = 224 px
MAX_OUTPUT_PIXELS = 150_000_000
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def plan_tiles(h: int, w: int) -> list[tuple[int, int]]:
    """Row-major `(y, x)` origins of TILE-px tiles covering an h x w image.

    Edge tiles may extend past the image; callers pad the source accordingly.
    """
    return [(y, x) for y in range(0, max(h, 1), TILE) for x in range(0, max(w, 1), TILE)]


def prescaled_size(w: int, h: int, prescale: int) -> tuple[int, int]:
    """Size after the optional pre-scale step: `prescale` percent of each side (100 = off).

    Half-up rounding, never below 1 px. Any percentage works; the model only sees the pixels.
    """
    if prescale >= 100:
        return w, h
    return max(1, (w * prescale + 50) // 100), max(1, (h * prescale + 50) // 100)


def output_size(w: int, h: int, native: int, scale: int, prescale: int = 100) -> tuple[int, int]:
    """Output (w, h) for a model of native factor `native`.

    Without `prescale` the result is `scale`x the source. With `prescale` < 100 the source is
    first resized to that percentage and the model then runs at its native scale (`scale` must
    be native), so the result is `prescaled x native`.
    """
    if prescale < 100:
        if scale != native:
            raise ValueError("pre-scaling always runs the model at its native scale")
        sw, sh = prescaled_size(w, h, prescale)
        return sw * native, sh * native
    if scale != native and (scale < 1 or scale > native or native % scale):
        raise ValueError(f"scale {scale}x is not available from a {native}x model")
    return w * scale, h * scale


def skip_reason(
    path: str, width: int | None, height: int | None, scale: int, prescale: int = 100
) -> str | None:
    """Why this file can't be upscaled, or None when it can (or when its size isn't known yet)."""
    if os.path.splitext(path)[1].lower() not in SUPPORTED_EXTENSIONS:
        return "format not supported"
    if width and height:
        out_w, out_h = prescaled_size(width, height, prescale)
        if out_w * scale * out_h * scale > MAX_OUTPUT_PIXELS:
            return "output would exceed 150 MP — pick a smaller size"
    return None


def output_path(
    src: str, scale: int, exists: Callable[[str], bool] = os.path.exists, prescale: int = 100
) -> str:
    """`<stem>_<n>x<ext>` (`<stem>_p<pct>_<n>x<ext>` when pre-scaled) next to the source.

    On collision `_1`, `_2`, … is appended (never overwrites).
    """
    stem, ext = os.path.splitext(src)
    tag = f"p{prescale}_{scale}x" if prescale < 100 else f"{scale}x"
    candidate = f"{stem}_{tag}{ext}"
    n = 0
    while exists(candidate):
        n += 1
        candidate = f"{stem}_{tag}_{n}{ext}"
    return candidate
