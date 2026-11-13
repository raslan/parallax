"""Offline translation language packs: registry, download + verify, install, remove.

A pack is a handful of files (a CTranslate2 model, two sentencepiece models, a vocabulary)
fetched straight from its uploader (Parallax does not redistribute them) and pinned per file
by size and sha256 in `app/assets/translate/packs.json`, so a replaced or corrupted upload
fails loudly instead of translating with the wrong model. Packs live in
`DATA_DIR/translate-packs/<lang>/`. English is the only source language.
"""

import hashlib
import json
import logging
import os
import shutil
from collections.abc import Callable, Iterator
from functools import lru_cache
from pathlib import Path

from app.database import DATA_DIR

logger = logging.getLogger(__name__)

PACKS_DIR = os.path.join(DATA_DIR, "translate-packs")
_REGISTRY = Path(__file__).resolve().parents[1] / "assets" / "translate" / "packs.json"


class PackError(Exception):
    """A pack download failed verification or could not be fetched (message is user-facing)."""


class PackCancelled(Exception):
    pass


_SPEECH_REGISTRY = (
    Path(__file__).resolve().parents[1] / "assets" / "translate" / "speech_models.json"
)


@lru_cache(maxsize=1)
def _load() -> list[dict]:
    return json.loads(_REGISTRY.read_text(encoding="utf-8"))["packs"]


@lru_cache(maxsize=1)
def _load_speech() -> list[dict]:
    return json.loads(_SPEECH_REGISTRY.read_text(encoding="utf-8"))["models"]


def list_packs() -> list[dict]:
    """The translation language packs."""
    return list(_load())


SPEECH_MODEL_KEY = "speech_model"  # the `settings` row holding the model Generate uses
DEFAULT_SPEECH_MODEL = "whisper-small"


def list_speech_models() -> list[dict]:
    """The speech-to-text models (Whisper), downloaded and verified exactly like a pack."""
    return list(_load_speech())


def get_pack(lang: str) -> dict | None:
    """A translation pack by language code, or a speech model by id (`whisper-small`)."""
    return next((p for p in (*_load(), *_load_speech()) if p["lang"] == lang), None)


def pack_dir(pack: dict) -> str:
    return os.path.join(PACKS_DIR, pack.get("dir", pack["lang"]))


def total_bytes(pack: dict) -> int:
    return sum(f["size"] for f in pack["files"])


def is_installed(pack: dict) -> bool:
    """Every file present at its pinned size. The hash was checked at install time, so listing
    packs does not have to re-read a 480 MB model."""
    d = pack_dir(pack)
    return all(
        os.path.isfile(os.path.join(d, f["name"]))
        and os.path.getsize(os.path.join(d, f["name"])) == f["size"]
        for f in pack["files"]
    )


def installed_bytes(pack: dict) -> int:
    d = pack_dir(pack)
    if not os.path.isdir(d):
        return 0
    return sum(e.stat().st_size for e in os.scandir(d) if e.is_file())


def remove_pack(pack: dict) -> bool:
    d = pack_dir(pack)
    if not os.path.isdir(d):
        return False
    shutil.rmtree(d)
    return True


def http_fetch(url: str) -> Iterator[bytes]:
    """Stream a file from its uploader."""
    import requests

    try:
        with requests.get(url, stream=True, timeout=60, headers={"User-Agent": "parallax"}) as r:
            r.raise_for_status()
            yield from r.iter_content(chunk_size=1 << 20)
    except requests.RequestException as e:
        raise PackError(f"Could not download {url.rsplit('/', 1)[1]}: {e}") from e


def install_pack(
    pack: dict,
    fetch: Callable[[str], Iterator[bytes]],
    progress: Callable[[float], None],
    is_cancelled: Callable[[], bool],
) -> None:
    """Download every file into a hidden staging folder, verify size and sha256 of each, then
    swap the folder into place. Failure or cancel removes the staging folder, so nothing partial
    is ever left where `is_installed` looks."""
    os.makedirs(PACKS_DIR, exist_ok=True)
    final = pack_dir(pack)
    staging = os.path.join(PACKS_DIR, f".{pack['lang']}.installing")
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging)
    try:
        total = total_bytes(pack) or 1
        done = 0
        for f in pack["files"]:
            digest = hashlib.sha256()
            size = 0
            with open(os.path.join(staging, f["name"]), "wb") as out:
                for chunk in fetch(f"{pack['base_url']}/{f['name']}"):
                    if is_cancelled():
                        raise PackCancelled()
                    out.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    progress(min(99.0, (done + size) / total * 100))
            if size != f["size"] or digest.hexdigest() != f["sha256"]:
                raise PackError(
                    f"{f['name']} does not match the expected download "
                    "(the upload may have changed). Nothing was installed."
                )
            done += size
        if is_cancelled():
            raise PackCancelled()
        shutil.rmtree(final, ignore_errors=True)
        os.makedirs(os.path.dirname(final), exist_ok=True)
        os.replace(staging, final)
        progress(100.0)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def run_pack_install_job(job_id: int, lang: str) -> None:
    """Queue job body: install one language pack, with progress and cancel on the Jobs page."""
    from app.database import SessionLocal
    from app.models.job import Job, JobStatus
    from app.services.common import arm_cancel, clear_cancel, fail_job, log, now, should_cancel

    pack = get_pack(lang)
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None or job.status == JobStatus.CANCELLED:
            return  # cancelled while queued: never start
        if pack is None:
            job.status = JobStatus.FAILED
            job.error = f"Unknown language pack: {lang}"
            job.finished_at = now()
            db.commit()
            return
        job.status = JobStatus.RUNNING
        job.started_at = now()
        noun = "speech model" if pack.get("kind") == "speech" else "language pack"
        job.current_file = f"{pack['name']} {noun}"
        db.commit()
        arm_cancel(job_id)
        log(db, job_id, f"Downloading the {pack['name']} {noun} ({total_bytes(pack) >> 20} MB)")

        last = {"pct": 0.0}

        def on_progress(pct: float) -> None:
            if pct - last["pct"] >= 1.0 or pct >= 100.0:
                last["pct"] = pct
                job.progress = pct
                db.commit()

        try:
            install_pack(pack, http_fetch, on_progress, lambda: should_cancel(job_id))
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            log(db, job_id, "Installed and verified.")
        except PackCancelled:
            job.status = JobStatus.CANCELLED
            log(db, job_id, "Cancelled; nothing was installed.")
        job.current_file = None
        job.finished_at = now()
        db.commit()
    except PackError as e:
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
            log(db, job_id, str(e), "error")
    except Exception as e:
        logger.exception("language pack install %s failed", lang)
        db.rollback()
        job = db.get(Job, job_id)
        if job:
            fail_job(db, job, e)
    finally:
        clear_cancel(job_id)
        db.close()
