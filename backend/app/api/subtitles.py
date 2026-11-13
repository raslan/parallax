import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.models.settings import get_setting
from app.queue import enqueue

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

_SUBTITLE_LANGUAGES_KEY = "subtitle_languages"
_SUBTITLE_LANGUAGES_DEFAULT = "en"


def _get_lang_codes(db: Session) -> list[str]:
    raw = get_setting(db, _SUBTITLE_LANGUAGES_KEY, _SUBTITLE_LANGUAGES_DEFAULT)
    return [c.strip() for c in raw.split(",") if c.strip()]


class ScanRequest(BaseModel):
    path: str


class DownloadRequest(BaseModel):
    path: str
    languages: list[str] | None = None


class SearchFileRequest(BaseModel):
    file_path: str
    languages: list[str] | None = None
    query: str | None = None
    year: int | None = None
    media_type: str | None = None
    season: int | None = None
    episode: int | None = None
    provider: str = "subf2m"


class DownloadOneRequest(BaseModel):
    file_path: str
    provider: str
    subtitle_id: str
    language: str


@router.post("/scan")
def scan_path(body: ScanRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")
    from app.services.subtitle_service import scan_directory

    return scan_directory(body.path, _get_lang_codes(db))


@router.post("/download")
async def download_subtitles(body: DownloadRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")

    lang_codes = body.languages or _get_lang_codes(db)

    from app.services.subtitle_service import run_download_job

    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        settings=json.dumps({"path": body.path, "languages": lang_codes}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await enqueue(job.id, run_download_job, job.id, body.path, lang_codes)

    return {"job_id": job.id}


@router.post("/search-file")
def search_file(body: SearchFileRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    lang_codes = body.languages or _get_lang_codes(db)
    from app.services.subtitle_service import search_file as svc_search

    tmdb_api_key = get_setting(db, "tmdb_api_key", "").strip() or None
    try:
        return svc_search(
            body.file_path,
            lang_codes,
            query=body.query,
            year=body.year,
            media_type=body.media_type,
            season=body.season,
            episode=body.episode,
            provider=body.provider,
            tmdb_api_key=tmdb_api_key,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/download-one")
async def download_one(body: DownloadOneRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    from app.services.subtitle_service import download_one as svc_download

    try:
        ok = svc_download(body.file_path, body.provider, body.subtitle_id, body.language)
        if not ok:
            raise HTTPException(404, "Subtitle not found or download failed")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))

    if get_setting(db, "subtitle_auto_sync", "true") == "true":
        from app.services.subtitle_sync import sync_subtitle

        base = os.path.splitext(body.file_path)[0]
        sub_path = f"{base}.{body.language}.srt"
        engine = get_setting(db, "subtitle_sync_engine", "alass")
        await enqueue(None, sync_subtitle, body.file_path, sub_path, engine)

    return {"ok": True}


@router.delete("/file")
def delete_subtitle_file(
    file_path: str = Query(...),
    language: str = Query(...),
    machine: bool = Query(False, description="Delete the machine-made subtitle instead"),
):
    if not os.path.isfile(file_path):
        raise HTTPException(400, "Video file not found")
    from app.services.subtitle_service import delete_subtitle

    if not delete_subtitle(file_path, language, machine=machine):
        raise HTTPException(404, "Subtitle not found")
    return {"ok": True}


class SyncFileRequest(BaseModel):
    file_path: str
    language: str | None = None


def _refuse_while_nvidia_installs(db: Session) -> None:
    """Jobs started while the NVIDIA package is swapped in or out would load half-written
    libraries, so they wait."""
    if (
        db.query(Job)
        .filter(
            Job.type == JobType.NVIDIA_PACKAGE,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .first()
    ):
        raise HTTPException(409, "The NVIDIA package is being installed; try again when it is done")


class TranslateRequest(BaseModel):
    file_paths: list[str]
    language: str
    source: str | None = None


@router.get("/translate-sources", summary="List the English subtitles that can be translated")
async def translate_sources(path: str = Query(..., description="Absolute path to the video")):
    """Every English `.srt` next to the video (real, hearing impaired or machine-made), real
    ones first. Pick one as `source` of `POST /subtitles/translate`."""
    from app.services import subtitle_translate

    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return await run_in_threadpool(subtitle_translate.list_sources, path)


@router.post("/translate", summary="Translate English subtitles offline")
async def translate_subtitles(body: TranslateRequest, db: Session = Depends(get_db)):
    """Queue a job that translates a video's English subtitle into `language` with an installed
    language pack. `source` is the subtitle file to translate, one of the video's English files
    from `GET /subtitles/translate-sources` (one video only); without it a real English file is
    used. The result is a machine-made `<name>.<lang>.machine.srt` next to the video; the real
    subtitle for that language is never replaced."""
    from app.services import machine_subs, subtitle_translate, translate_packs

    if not body.file_paths:
        raise HTTPException(422, "No files selected")
    if body.source is not None and len(set(body.file_paths)) != 1:
        raise HTTPException(422, "A source subtitle can only be chosen for one video")
    _refuse_while_nvidia_installs(db)
    pack = translate_packs.get_pack(body.language)
    if pack is None or pack.get("kind") == "speech":
        raise HTTPException(422, f"No language pack for '{body.language}'")
    if not translate_packs.is_installed(pack):
        raise HTTPException(
            409, f"Install the {pack['name']} language pack first (Settings → Subtitles)"
        )
    paths = list(dict.fromkeys(body.file_paths))
    for path in paths:
        if not os.path.isfile(path):
            raise HTTPException(400, f"File not found: {os.path.basename(path)}")
    # The folder walks can be slow on a network mount: keep them off the event loop.
    problem = await run_in_threadpool(
        subtitle_translate.first_problem, paths, body.language, pack["name"], body.source
    )
    if problem:
        raise HTTPException(422, problem)
    drop_hi = get_setting(db, "subtitle_translate_drop_hi", "false") == "true"
    items = [
        {"video_path": p, "lang": body.language, "drop_hi": drop_hi, "source": body.source}
        for p in paths
    ]

    job = Job(
        type=JobType.SUBTITLE_TRANSLATE,
        status=JobStatus.PENDING,
        total_files=len(items),
        settings=json.dumps({"items": items, "marker": machine_subs.MARKER}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, subtitle_translate.run_translate_job, job.id, items)
    return {"job_id": job.id}


class GenerateRequest(BaseModel):
    file_paths: list[str]
    model: str = "small"


@router.post("/generate", summary="Generate an English subtitle from the audio")
async def generate_subtitles(body: GenerateRequest, db: Session = Depends(get_db)):
    """Queue a job that transcribes each video's English speech with an installed Whisper model.
    The result is a machine-made `<name>.en.machine.srt` next to the video, a stopgap until a real
    subtitle exists. Translating it is a separate request (`POST /subtitles/translate`)."""
    from app.services import subtitle_generate, translate_packs
    from app.services.subtitle_service import _missing_lang_codes

    if not body.file_paths:
        raise HTTPException(422, "No files selected")
    _refuse_while_nvidia_installs(db)
    model = translate_packs.get_pack(f"whisper-{body.model}")
    if model is None or model.get("kind") != "speech":
        raise HTTPException(422, f"Unknown speech model '{body.model}'")
    if not translate_packs.is_installed(model):
        raise HTTPException(409, f"Install the {model['name']} model first (Settings → Subtitles)")
    paths = list(dict.fromkeys(body.file_paths))
    for path in paths:
        if not os.path.isfile(path):
            raise HTTPException(400, f"File not found: {os.path.basename(path)}")
    already = await run_in_threadpool(
        lambda: next(
            (
                os.path.basename(p)
                for p in paths
                if subtitle_generate.LANGUAGE
                not in _missing_lang_codes(p, [subtitle_generate.LANGUAGE])
            ),
            None,
        )
    )
    if already:
        raise HTTPException(422, f"{already} already has an English subtitle")
    items = [{"video_path": p, "model": model["lang"]} for p in paths]
    job = Job(
        type=JobType.SUBTITLE_GENERATE,
        status=JobStatus.PENDING,
        total_files=len(items),
        settings=json.dumps({"items": items}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, subtitle_generate.run_generate_job, job.id, items)
    return {"job_id": job.id}


@router.post("/sync-file")
async def sync_file(body: SyncFileRequest, db: Session = Depends(get_db)):
    if not os.path.isfile(body.file_path):
        raise HTTPException(400, "File not found")
    from app.services.subtitle_service import find_all_subtitle_tracks

    tracks = find_all_subtitle_tracks(body.file_path)
    if body.language:
        tracks = [t for t in tracks if t["lang"] == body.language]
    if not tracks:
        raise HTTPException(422, "No subtitle files found to sync")

    engine = get_setting(db, "subtitle_sync_engine", "alass")
    job = Job(type=JobType.SUBTITLE_SYNC, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.subtitle_sync import run_sync_job

    targets = [(body.file_path, t["path"]) for t in tracks]
    await enqueue(job.id, run_sync_job, job.id, targets, engine)
    return {"job_id": job.id}


class SyncBulkRequest(BaseModel):
    path: str


@router.post("/sync-bulk")
async def sync_bulk(body: SyncBulkRequest, db: Session = Depends(get_db)):
    if not os.path.isdir(body.path):
        raise HTTPException(400, "Path is not a directory")
    from app.services.subtitle_sync import collect_sync_targets

    targets = collect_sync_targets(body.path)
    if not targets:
        raise HTTPException(422, "No subtitle files found to sync")

    engine = get_setting(db, "subtitle_sync_engine", "alass")
    job = Job(
        type=JobType.SUBTITLE_SYNC,
        status=JobStatus.PENDING,
        settings=json.dumps({"path": body.path}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.services.subtitle_sync import run_sync_job

    await enqueue(job.id, run_sync_job, job.id, targets, engine)
    return {"job_id": job.id}


@router.get("/tracks")
def tracks_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Return all subtitle tracks for a video at an arbitrary path."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    from urllib.parse import quote

    from app.services.subtitle_service import find_all_subtitle_tracks

    tracks = find_all_subtitle_tracks(path)
    return [
        {
            "label": t["label"],
            "lang": t["lang"],
            "hearing_impaired": t["hearing_impaired"],
            "machine_made": t["machine_made"],
            "url": f"/api/subtitles/vtt?path={quote(t['path'])}",
        }
        for t in tracks
    ]


@router.get("/vtt")
def serve_vtt_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Serve subtitle as WebVTT for a video at an arbitrary path."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    from app.services.subtitle_service import find_and_serve_vtt

    vtt = find_and_serve_vtt(path)
    if vtt is None:
        raise HTTPException(404, "No subtitle found")
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


@router.get("/stream")
def stream_by_path(path: str = Query(..., description="Absolute path to video file")):
    """Stream a video file at an arbitrary path (for subtitle preview)."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)
