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


def output_size(w: int, h: int, native: int, scale: int) -> tuple[int, int]:
    """Output (w, h) for a model of native factor `native` producing `scale`x the source."""
    if scale != native and (scale < 1 or scale > native or native % scale):
        raise ValueError(f"scale {scale}x is not available from a {native}x model")
    return w * scale, h * scale


def skip_reason(path: str, width: int | None, height: int | None, scale: int) -> str | None:
    """Why this file can't be upscaled, or None when it can (or when its size isn't known yet)."""
    if os.path.splitext(path)[1].lower() not in SUPPORTED_EXTENSIONS:
        return "format not supported"
    if width and height and width * height * scale * scale > MAX_OUTPUT_PIXELS:
        return "output would exceed 150 MP — pick a smaller size"
    return None


def output_path(src: str, scale: int, exists: Callable[[str], bool] = os.path.exists) -> str:
    """`<stem>_<n>x<ext>` next to the source; on collision `_1`, `_2`, … (never overwrites)."""
    stem, ext = os.path.splitext(src)
    candidate = f"{stem}_{scale}x{ext}"
    n = 0
    while exists(candidate):
        n += 1
        candidate = f"{stem}_{scale}x_{n}{ext}"
    return candidate
