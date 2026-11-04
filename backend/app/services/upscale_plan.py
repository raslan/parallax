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


def shrunk_size(w: int, h: int, shrink: int) -> tuple[int, int]:
    """Size after the optional shrink-first step (half-up rounding, never below 1 px)."""
    if shrink <= 1:
        return w, h
    return max(1, (w + shrink // 2) // shrink), max(1, (h + shrink // 2) // shrink)


def output_size(w: int, h: int, native: int, scale: int, shrink: int = 1) -> tuple[int, int]:
    """Output (w, h) for a model of native factor `native`.

    Without `shrink` the result is `scale`x the source. With `shrink` > 1 the source is first
    shrunk by that factor and the model then runs at its native scale (`scale` must be native).
    """
    if shrink > 1:
        if scale != native:
            raise ValueError("shrink-first always runs the model at its native scale")
        sw, sh = shrunk_size(w, h, shrink)
        return sw * native, sh * native
    if scale != native and (scale < 1 or scale > native or native % scale):
        raise ValueError(f"scale {scale}x is not available from a {native}x model")
    return w * scale, h * scale


def skip_reason(
    path: str, width: int | None, height: int | None, scale: int, shrink: int = 1
) -> str | None:
    """Why this file can't be upscaled, or None when it can (or when its size isn't known yet)."""
    if os.path.splitext(path)[1].lower() not in SUPPORTED_EXTENSIONS:
        return "format not supported"
    if width and height:
        out_w, out_h = shrunk_size(width, height, shrink)
        if out_w * scale * out_h * scale > MAX_OUTPUT_PIXELS:
            return "output would exceed 150 MP — pick a smaller size"
    return None


def output_path(
    src: str, scale: int, exists: Callable[[str], bool] = os.path.exists, shrink: int = 1
) -> str:
    """`<stem>_<n>x<ext>` (`<stem>_s<k>_<n>x<ext>` when shrunk first) next to the source.

    On collision `_1`, `_2`, … is appended (never overwrites).
    """
    stem, ext = os.path.splitext(src)
    tag = f"s{shrink}_{scale}x" if shrink > 1 else f"{scale}x"
    candidate = f"{stem}_{tag}{ext}"
    n = 0
    while exists(candidate):
        n += 1
        candidate = f"{stem}_{tag}_{n}{ext}"
    return candidate
