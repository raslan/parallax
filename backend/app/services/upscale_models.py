"""Registry of the bundled ncnn upscaler models.

Data lives in `app/assets/upscale/models.json` next to the model files, which are pre-converted
ncnn files bundled unchanged (source and file hashes per model are recorded there); this module
resolves paths and verifies file hashes lazily on first use. Attribution and licences live in
`app/assets/credits.json` (one entry per model, matched by name). To add or replace a model: drop
its `.param`/`.bin` in that folder, add an entry to `models.json` and `SHA256SUMS`, add its tier
copy to `_TIER_COPY` below, and add its credit to `credits.json`.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "upscale"

# Presentation copy, keyed by tier id. Speed is a relative label only: real seconds depend too
# much on the hardware.
_TIER_COPY: dict[str, dict[str, str]] = {
    "fast": {
        "label": "Fast",
        "speed": "fast",
        "hint": "The quick, clean default. Adds very little invented detail (faces, hands and "
        "toes stay faithful) and handles JPEG photos well, but fine texture such as hair "
        "or rock comes out a little soft.",
    },
    "sharp": {
        "label": "Sharp",
        "speed": "fast",
        "hint": "As quick as Fast but crisper, and good at cleaning up JPEG artefacts. Can add "
        "faint texture to fine detail such as toes or eyelids.",
    },
    "natural": {
        "label": "Natural",
        "speed": "slow",
        "hint": "A clean, photographic look with more fine detail than Fast. Slower, and "
        "still careful not to invent detail.",
    },
}
_TIER_ORDER = ("fast", "sharp", "natural")

_verified: set[str] = set()


class UpscaleModelError(Exception):
    """A model is unknown, missing on disk, or does not match its recorded hash."""


@dataclass(frozen=True)
class UpscaleTier:
    id: str
    label: str
    model: str
    scale: int
    speed: str
    hint: str
    param_path: str
    bin_path: str
    size_bytes: int
    input_blob: str = "in0"  # pnnx output; pre-converted hub files use "data" / "output"
    output_blob: str = "out0"


def _load() -> dict:
    try:
        return json.loads((ASSETS_DIR / "models.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UpscaleModelError(f"Upscale model registry is unreadable: {exc}") from exc


def _entry(tier_id: str) -> dict:
    for m in _load()["models"]:
        if m["tier"] == tier_id:
            return m
    raise UpscaleModelError(f"Unknown upscale tier: {tier_id}")


def _tier_from(m: dict) -> UpscaleTier:
    copy = _TIER_COPY[m["tier"]]
    return UpscaleTier(
        id=m["tier"],
        label=copy["label"],
        model=m["name"],
        scale=m["scale"],
        speed=copy["speed"],
        hint=copy["hint"],
        param_path=str(ASSETS_DIR / m["param"]),
        bin_path=str(ASSETS_DIR / m["bin"]),
        size_bytes=m["size_bytes"],
        input_blob=m["input_blob"],
        output_blob=m["output_blob"],
    )


def list_tiers() -> list[UpscaleTier]:
    by_id = {m["tier"]: m for m in _load()["models"]}
    return [_tier_from(by_id[t]) for t in _TIER_ORDER if t in by_id]


def get_tier(tier_id: str) -> UpscaleTier:
    if tier_id not in _TIER_COPY:
        raise UpscaleModelError(f"Unknown upscale tier: {tier_id}")
    return _tier_from(_entry(tier_id))


def allowed_scales(tier: UpscaleTier) -> tuple[int, ...]:
    """Output factors a tier can produce: its native scale and every integer divisor of it."""
    return tuple(s for s in (1, 2, 4) if s <= tier.scale and tier.scale % s == 0)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_tier_files(tier: UpscaleTier) -> None:
    """Check a tier's files against models.json once per process; raises UpscaleModelError."""
    key = f"{ASSETS_DIR}:{tier.id}"
    if key in _verified:
        return
    m = _entry(tier.id)
    for path, expected in ((tier.param_path, m["param_sha256"]), (tier.bin_path, m["bin_sha256"])):
        p = Path(path)
        if not p.is_file():
            raise UpscaleModelError(f"Upscale model file is missing: {p.name}")
        if _sha256(p) != expected:
            raise UpscaleModelError(f"Upscale model file is corrupt: {p.name}")
    _verified.add(key)
