from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services import translate_packs

router = APIRouter(prefix="/subtitle-packs", tags=["subtitle-packs"])

_ACTIVE = [JobStatus.PENDING, JobStatus.RUNNING]


class PackInfo(BaseModel):
    lang: str
    name: str
    source_lang: str
    model: str
    size_bytes: int
    installed: bool
    installed_bytes: int
    licence: str
    licence_url: str
    upstream_url: str
    installing_job_id: int | None


def _active_installs(db: Session) -> dict[str, int]:
    """lang → job id of the pending/running install, from each job's `settings` (the lang)."""
    rows = db.query(Job).filter(Job.type == JobType.PACK_DOWNLOAD, Job.status.in_(_ACTIVE)).all()
    return {j.settings: j.id for j in rows if j.settings}


def _info(pack: dict, installing: dict[str, int]) -> PackInfo:
    return PackInfo(
        lang=pack["lang"],
        name=pack["name"],
        source_lang=pack["source_lang"],
        model=pack["model"],
        size_bytes=translate_packs.total_bytes(pack),
        installed=translate_packs.is_installed(pack),
        installed_bytes=translate_packs.installed_bytes(pack),
        licence=pack["licence"],
        licence_url=pack["licence_url"],
        upstream_url=pack["upstream_url"],
        installing_job_id=installing.get(pack["lang"]),
    )


speech_router = APIRouter(prefix="/speech-models", tags=["subtitle-packs"])


def _find(lang: str, speech: bool) -> dict:
    pack = translate_packs.get_pack(lang)
    if pack is None or (pack.get("kind") == "speech") != speech:
        raise HTTPException(404, "Unknown speech model" if speech else "Unknown language pack")
    return pack


async def _install(lang: str, speech: bool, db: Session) -> dict:
    pack = _find(lang, speech)
    what = "speech model" if speech else "language pack"
    if translate_packs.is_installed(pack):
        raise HTTPException(409, f"This {what} is already installed")
    if lang in _active_installs(db):
        raise HTTPException(409, f"This {what} is already being installed")
    job = Job(type=JobType.PACK_DOWNLOAD, status=JobStatus.PENDING, settings=lang)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, translate_packs.run_pack_install_job, job.id, lang)
    return {"job_id": job.id}


def _remove(lang: str, speech: bool, db: Session) -> None:
    pack = _find(lang, speech)
    what = "speech model" if speech else "language pack"
    if lang in _active_installs(db):
        raise HTTPException(409, f"This {what} is being installed; cancel that first")
    # A generate job can also translate (its `translate_to`), so it uses language packs too.
    job_types = (
        [JobType.SUBTITLE_GENERATE]
        if speech
        else [JobType.SUBTITLE_TRANSLATE, JobType.SUBTITLE_GENERATE]
    )
    if db.query(Job).filter(Job.type.in_(job_types), Job.status.in_(_ACTIVE)).first():
        raise HTTPException(409, f"A job is using it; remove the {what} when it has finished")
    if not translate_packs.remove_pack(pack):
        raise HTTPException(404, f"This {what} is not installed")


@router.get("", response_model=list[PackInfo], summary="List language packs")
def list_packs(db: Session = Depends(get_db)):
    installing = _active_installs(db)
    return [_info(p, installing) for p in translate_packs.list_packs()]


@router.post("/{lang}/install", status_code=202, summary="Install a language pack")
async def install_pack(lang: str, db: Session = Depends(get_db)):
    return await _install(lang, False, db)


@router.delete("/{lang}", status_code=204, summary="Remove a language pack")
def remove_pack(lang: str, db: Session = Depends(get_db)):
    _remove(lang, False, db)


@speech_router.get("", response_model=list[PackInfo], summary="List speech-to-text models")
def list_speech_models(db: Session = Depends(get_db)):
    installing = _active_installs(db)
    return [_info(p, installing) for p in translate_packs.list_speech_models()]


@speech_router.post("/{model_id}/install", status_code=202, summary="Install a speech model")
async def install_speech_model(model_id: str, db: Session = Depends(get_db)):
    return await _install(model_id, True, db)


@speech_router.delete("/{model_id}", status_code=204, summary="Remove a speech model")
def remove_speech_model(model_id: str, db: Session = Depends(get_db)):
    _remove(model_id, True, db)
