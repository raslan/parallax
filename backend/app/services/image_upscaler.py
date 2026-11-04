"""Image upscale job runner.

`upscale_array` is the pure tile loop (reflect-padded 192 px tiles, optional per-tile Lanczos
downscale to the chosen factor, stitched into one uint8 buffer). `run_image_upscale_job` is the
queue job body: per-file load -> upscale -> temp write -> verify -> move next to the source.
Never holds a DB session across the tile loop or file IO.
"""

import contextlib
import json
import logging
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.database import SessionLocal
from app.models.image import ImageFile
from app.models.job import Job, JobStatus
from app.services import fs_watcher, upscale_plan, upscale_runtime
from app.services.common import (
    arm_cancel,
    clear_cancel,
    fail_job,
    now,
    should_cancel,
    temp_sibling_path,
)
from app.services.upscale_image_io import UnsupportedImage, load_image, save_image
from app.services.upscale_models import UpscaleTier, get_tier, verify_tier_files
from app.services.upscale_runtime import release_sessions

logger = logging.getLogger(__name__)

_PROGRESS_INTERVAL = 0.5  # seconds between job-row progress writes


def _reflect(idx: np.ndarray, n: int) -> np.ndarray:
    """Map indices outside [0, n) back inside by mirroring at the edges (no edge repeat)."""
    if n == 1:
        return np.zeros_like(idx)
    period = 2 * (n - 1)
    m = idx % period
    return np.where(m >= n, period - m, m)


def _to_uint8(chw: np.ndarray) -> np.ndarray:
    out = np.clip(np.nan_to_num(chw, nan=0.0), 0.0, 1.0) * 255.0 + 0.5
    return np.ascontiguousarray(out.astype(np.uint8).transpose(1, 2, 0))


def upscale_array(
    rgb: np.ndarray,
    tier: UpscaleTier,
    scale: int,
    device: str,
    on_tile: Callable[[], None],
    is_cancelled: Callable[[], bool],
    tile_fn: Callable[..., np.ndarray] | None = None,
) -> np.ndarray | None:
    """Upscale `rgb` (uint8 HxWx3) to `scale`x using the tier's model; None if cancelled.

    When `scale` is below the model's native factor, each tile's full padded output is Lanczos
    downscaled *before* the central crop, so the stitched buffer is only ever the chosen size.
    """
    tile_fn = tile_fn or upscale_runtime.run_tile
    h, w = rgb.shape[:2]
    upscale_plan.output_size(w, h, tier.scale, scale)  # validates the scale/native pair
    padded = upscale_plan.TILE + 2 * upscale_plan.PAD
    out = np.empty((h * scale, w * scale, 3), dtype=np.uint8)
    crop_from = upscale_plan.PAD * scale
    crop_len = upscale_plan.TILE * scale

    for y, x in upscale_plan.plan_tiles(h, w):
        if is_cancelled():
            return None
        ys = _reflect(np.arange(y - upscale_plan.PAD, y - upscale_plan.PAD + padded), h)
        xs = _reflect(np.arange(x - upscale_plan.PAD, x - upscale_plan.PAD + padded), w)
        patch = rgb[np.ix_(ys, xs)]
        tile = np.ascontiguousarray(patch.transpose(2, 0, 1), dtype=np.float32) / 255.0
        img = _to_uint8(tile_fn(tier, device, tile))
        if scale != tier.scale:
            side = padded * scale
            img = np.asarray(Image.fromarray(img).resize((side, side), Image.Resampling.LANCZOS))
        crop = img[crop_from : crop_from + crop_len, crop_from : crop_from + crop_len]
        oy, ox = y * scale, x * scale
        ch, cw = min(crop_len, out.shape[0] - oy), min(crop_len, out.shape[1] - ox)
        out[oy : oy + ch, ox : ox + cw] = crop[:ch, :cw]
        on_tile()
    return out


# --------------------------------------------------------------------------- job runner


@dataclass
class _Source:
    id: int
    path: str
    library_id: int
    width: int | None
    height: int | None


def _header_size(path: str) -> tuple[int, int] | None:
    try:
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def _set_job(job_id: int, **fields) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is not None:
            for k, v in fields.items():
                setattr(job, k, v)
            db.commit()
    finally:
        db.close()


class _Device:
    """The device for the whole job; flips to "cpu" once if the GPU path errors."""

    def __init__(self, device: str) -> None:
        self.device = device

    def run_tile(self, tier: UpscaleTier, _device: str, tile: np.ndarray) -> np.ndarray:
        try:
            return upscale_runtime.run_tile(tier, self.device, tile)
        except Exception:
            if self.device != "gpu":
                raise
            logger.warning("GPU upscale failed, falling back to CPU", exc_info=True)
            self.device = "cpu"
            return upscale_runtime.run_tile(tier, "cpu", tile)


def _upscale_one(
    src: _Source,
    tier: UpscaleTier,
    scale: int,
    dev: _Device,
    is_cancelled: Callable[[], bool],
    on_tile: Callable[[], None],
) -> dict | None:
    """Upscale one file. Returns its result dict, or None when cancelled."""
    result = {"id": src.id, "output": None, "skipped": None, "error": None}
    if not os.path.isfile(src.path):
        result["skipped"] = "source file no longer exists"
        return result
    try:
        loaded = load_image(src.path)
    except UnsupportedImage as exc:
        result["skipped"] = str(exc)
        return result
    h, w = loaded.rgb.shape[:2]
    reason = upscale_plan.skip_reason(src.path, w, h, scale)
    if reason:
        result["skipped"] = reason
        return result

    ext = os.path.splitext(src.path)[1]
    tmp = temp_sibling_path(src.path, ext, "compressing")
    try:
        out = upscale_array(
            loaded.rgb, tier, scale, dev.device, on_tile, is_cancelled, dev.run_tile
        )
        if out is None:
            return None
        save_image(tmp, out, loaded)
        with Image.open(tmp) as check:
            if check.size != (w * scale, h * scale):
                raise RuntimeError("written file has the wrong dimensions")
        final = upscale_plan.output_path(src.path, scale)
        shutil.move(tmp, final)
        result["output"] = final
    except Exception as exc:
        logger.warning("upscale of %s failed", src.path, exc_info=True)
        result["error"] = f"{type(exc).__name__}: {exc}"[:300]
    finally:
        with contextlib.suppress(OSError):
            os.remove(tmp)
    if result["output"]:
        # Best-effort: show the new file at once instead of waiting for the watcher's debounce.
        with contextlib.suppress(Exception):
            fs_watcher._apply("image", src.library_id, frozenset({result["output"]}))
    return result


def run_image_upscale_job(
    job_id: int, file_ids: list[int], tier_id: str, scale: int, force_cpu: bool
) -> None:
    try:
        db = SessionLocal()
        try:
            job = db.get(Job, job_id)
            if job is None:
                return
            job.status = JobStatus.RUNNING
            job.started_at = now()
            rows = {
                r.id: _Source(r.id, r.path, r.library_id, r.width, r.height)
                for r in db.query(ImageFile).filter(ImageFile.id.in_(file_ids)).all()
            }
            sources = [rows[i] for i in file_ids if i in rows]
            job.total_files = len(sources)
            existing = json.loads(job.settings) if job.settings else {}
            db.commit()
        finally:
            db.close()

        tier = get_tier(tier_id)
        verify_tier_files(tier)
        dev = _Device(upscale_runtime.choose_device(force_cpu))

        # Tiles per file drive the progress bar; unknown sizes are read header-only.
        total_tiles = 0
        for s in sources:
            if not (s.width and s.height):
                size = _header_size(s.path)
                s.width, s.height = size if size else (None, None)
            if s.width and s.height:
                total_tiles += len(upscale_plan.plan_tiles(s.height, s.width))
        total_tiles = max(total_tiles, 1)

        arm_cancel(job_id)
        done_tiles = 0
        last_write = 0.0
        results: list[dict] = []
        current = ""

        def is_cancelled() -> bool:
            return should_cancel(job_id)

        def on_tile() -> None:
            nonlocal done_tiles, last_write
            done_tiles += 1
            t = time.monotonic()
            if t - last_write >= _PROGRESS_INTERVAL:
                last_write = t
                _set_job(
                    job_id,
                    progress=min(done_tiles / total_tiles * 100.0, 99.0),
                    current_file=current,
                )

        cancelled = False
        try:
            for s in sources:
                if is_cancelled():
                    cancelled = True
                    break
                current = os.path.basename(s.path)
                _set_job(job_id, current_file=current)
                res = _upscale_one(s, tier, scale, dev, is_cancelled, on_tile)
                if res is None:
                    cancelled = True
                    break
                results.append(res)
                _set_job(job_id, processed_files=len(results))
        finally:
            clear_cancel(job_id)

        ok = [r for r in results if r["output"]]
        bad = [r for r in results if not r["output"]]
        if cancelled:
            status = JobStatus.CANCELLED
        elif bad and not ok:
            status = JobStatus.FAILED
        else:
            status = JobStatus.COMPLETED
        existing["results"] = results
        fields = dict(
            status=status,
            finished_at=now(),
            current_file=None,
            processed_files=len(results),
            settings=json.dumps(existing),
        )
        if status != JobStatus.CANCELLED:
            fields["progress"] = 100.0
        if bad and not cancelled:
            reasons = "; ".join((r["skipped"] or r["error"] or "failed") for r in bad[:3])
            fields["error"] = f"{len(bad)} file(s) not upscaled: {reasons}"[:512]
        _set_job(job_id, **fields)
    except Exception as exc:
        logger.exception("image upscale job %s crashed", job_id)
        clear_cancel(job_id)
        db = SessionLocal()
        try:
            fail_job(db, db.get(Job, job_id), exc)
        finally:
            db.close()
    finally:
        release_sessions()
