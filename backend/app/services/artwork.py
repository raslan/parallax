"""Generate opinionated show + season artwork for Identify's custom-show mode
from a single frame of episode 1 — no external metadata, ffmpeg + Pillow only.

poster.jpg / folder.jpg  : blurred, darkened frame with the show title in
                           Inter Black, text colour hue-matched to the frame.
backdrop.jpg / fanart.jpg : the same frame, lightly darkened, no text.
Season NN/folder.jpg      : a copy of the poster.

Both Jellyfin and Plex pick these up by filename with no network access.
"""

import colorsys
import io
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

_FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Inter-VF.ttf"
# Inter variable axes: [Optical Size 14-32, Weight 100-900]
_FONT_AXES = [32.0, 900.0]
_POSTER = (1000, 1500)
_BACKDROP = (1920, 1080)

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def _font(size: int) -> ImageFont.FreeTypeFont:
    f = _font_cache.get(size)
    if f is None:
        f = ImageFont.truetype(str(_FONT_PATH), size)
        try:
            f.set_variation_by_axes(_FONT_AXES)
        except Exception:
            pass
        _font_cache[size] = f
    return f


def extract_frame(video_path: str) -> Image.Image | None:
    """A single RGB frame ~30% into the video (past intros, before credits)."""
    seek = 10.0
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        dur = float(probe.stdout.strip())
        if dur > 0:
            seek = dur * 0.3
    except Exception:
        pass

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-ss",
                f"{seek:.2f}",
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "png",
                "-",
            ],
            capture_output=True,
            timeout=45,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        return Image.open(io.BytesIO(result.stdout)).convert("RGB")
    except Exception:
        return None


def _cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Scale to cover w×h, then centre-crop."""
    scale = max(w / img.width, h / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    return resized.crop((left, top, left + w, top + h))


def _title_color(img: Image.Image) -> tuple[int, int, int]:
    """A barely-tinted near-white keyed to the frame's dominant hue, so the
    title reads as belonging to the scene (cool for ocean, warm for sunset)."""
    r, g, b = img.resize((1, 1), Image.BOX).getpixel((0, 0))[:3]
    hue, _, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    nr, ng, nb = colorsys.hsv_to_rgb(hue, 0.14, 0.97)
    return round(nr * 255), round(ng * 255), round(nb * 255)


def _wrap(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int
) -> list[str]:
    lines: list[str] = []
    line = ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def build_poster(frame: Image.Image, title: str) -> bytes:
    w, h = _POSTER
    base = _cover(frame, w, h).filter(ImageFilter.GaussianBlur(20))
    base = ImageEnhance.Brightness(base).enhance(0.5)
    canvas = base.convert("RGBA")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    margin = 90
    max_w = w - 2 * margin

    size = 170
    while size >= 52:
        font = _font(size)
        lines = _wrap(draw, title, font, max_w)
        line_h = font.getbbox("Ag")[3] + round(size * 0.06)
        block_h = line_h * len(lines)
        widest = max((draw.textlength(ln, font=font) for ln in lines), default=0)
        if block_h <= h * 0.5 and widest <= max_w and len(lines) <= 3:
            break
        size -= 10
    else:
        font = _font(52)
        lines = _wrap(draw, title, font, max_w)
        line_h = font.getbbox("Ag")[3] + 6
        block_h = line_h * len(lines)

    y = (h - block_h) // 2
    plate_pad = 34
    draw.rounded_rectangle(
        (margin - plate_pad, y - plate_pad, w - margin + plate_pad, y + block_h + plate_pad),
        radius=28,
        fill=(0, 0, 0, 110),
    )
    color = _title_color(frame)
    for ln in lines:
        lw = draw.textlength(ln, font=font)
        x = (w - lw) // 2
        draw.text((x + 3, y + 3), ln, font=font, fill=(0, 0, 0, 170))
        draw.text((x, y), ln, font=font, fill=(*color, 255))
        y += line_h

    return _jpeg(Image.alpha_composite(canvas, overlay).convert("RGB"))


def build_backdrop(frame: Image.Image) -> bytes:
    base = _cover(frame, *_BACKDROP)
    return _jpeg(ImageEnhance.Brightness(base).enhance(0.85))


def _jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def artwork_paths(show_folder: str, season: int) -> list[tuple[str, str]]:
    """(path, kind) for every artwork file, kind ∈ {"poster", "backdrop"}.
    Listed without rendering, for the preview."""
    season_dir = os.path.join(show_folder, f"Season {season:02d}")
    return [
        (os.path.join(show_folder, "poster.jpg"), "poster"),
        (os.path.join(show_folder, "folder.jpg"), "poster"),
        (os.path.join(show_folder, "backdrop.jpg"), "backdrop"),
        (os.path.join(show_folder, "fanart.jpg"), "backdrop"),
        (os.path.join(season_dir, "folder.jpg"), "poster"),
    ]


def generate_show_artwork(
    video_path: str, show_folder: str, title: str, season: int
) -> list[tuple[str, bytes]]:
    """(path, jpeg-bytes) pairs for every artwork file, or [] if the frame
    couldn't be extracted."""
    frame = extract_frame(video_path)
    if frame is None:
        return []
    rendered = {
        "poster": build_poster(frame, title),
        "backdrop": build_backdrop(frame),
    }
    return [(path, rendered[kind]) for path, kind in artwork_paths(show_folder, season)]
