"""Subtitle search, candidate preview, release-token comparison and the approved-items run job for
the Subtitles page."""

import asyncio
import json
import os
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services import scanner, subtitle_preview, subtitle_run, subtitle_search
from app.services.subtitle_files import SubtitleFileError, SubtitleNotFound, _require_video
from app.services.subtitle_providers import Identity, ProviderError, SearchQuery, known_providers

router = APIRouter(prefix="/subtitles", tags=["subtitles"])

# A language code goes into a file name, so it is held to a plain code (`en`, `pt-BR`).
_LANG_PATTERN = r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$"
_PROVIDER_PATTERN = r"^[a-z0-9]{1,32}$"


class IdentityModel(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    year: int | None = Field(default=None, ge=1870, le=2200)
    type: Literal["movie", "tv"]
    imdb_id: str | None = Field(default=None, pattern=r"^tt\d{6,10}$")
    tmdb_id: int | None = None
    subf2m_path: str | None = Field(default=None, max_length=300)


class SearchRequest(BaseModel):
    video_path: str
    identity: IdentityModel
    languages: list[str] = Field(min_length=1, max_length=20)
    providers: list[str] = Field(min_length=1, max_length=5)
    season: int | None = Field(default=None, ge=0, le=1000)
    episode: int | None = Field(default=None, ge=0, le=10000)


class RunItem(BaseModel):
    video_path: str
    language: str = Field(pattern=_LANG_PATTERN)
    provider: str = Field(pattern=_PROVIDER_PATTERN)
    subtitle_id: str = Field(min_length=1, max_length=2000)
    sync: bool = False
    # The video's own season and episode: when the choice is a season pack, only this
    # episode's file is taken out of it.
    season: int | None = Field(default=None, ge=0, le=1000)
    episode: int | None = Field(default=None, ge=0, le=10000)

    @field_validator("provider")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in known_providers():
            raise ValueError("Unknown source")
        return v


class SearchTitleModel(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    identity: IdentityModel
    # The identity is certain: Identify's layout was recognised, or the user chose or confirmed
    # it. Automatic save never saves for a title that is not.
    certain: bool


class SearchRowModel(BaseModel):
    """One video plus one wanted language. `key` is opaque: the page and the job use it only to
    find the row again."""

    key: str = Field(min_length=1, max_length=4200)
    title_key: str = Field(min_length=1, max_length=300)
    video_path: str = Field(max_length=4096)
    language: str = Field(pattern=_LANG_PATTERN)
    season: int | None = Field(default=None, ge=0, le=1000)
    episode: int | None = Field(default=None, ge=0, le=10000)


class SaveOptionsModel(BaseModel):
    keep_existing: bool = False
    sync_after: bool = False
    engine: Literal["alass", "ffsubsync"] | None = None


class SearchesRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    providers: list[str] = Field(min_length=1, max_length=5)
    languages: list[str] = Field(min_length=1, max_length=20)
    scope: Literal["missing", "all"]
    check_lengths: bool = True
    # Present = save the sure matches automatically (needs `check_lengths`); null = review.
    save: SaveOptionsModel | None = None
    titles: list[SearchTitleModel] = Field(min_length=1, max_length=5000)
    rows: list[SearchRowModel] = Field(min_length=1, max_length=5000)

    @field_validator("providers")
    @classmethod
    def _known_providers(cls, v: list[str]) -> list[str]:
        if any(p not in known_providers() for p in v):
            raise ValueError("Unknown source")
        return v

    @field_validator("languages")
    @classmethod
    def _plain_languages(cls, v: list[str]) -> list[str]:
        if any(not re.fullmatch(_LANG_PATTERN, lang) for lang in v):
            raise ValueError("Not a language code")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> "SearchesRequest":
        if self.save is not None and not self.check_lengths:
            raise ValueError("Saving automatically needs the length check")
        title_keys = [t.key for t in self.titles]
        if len(set(title_keys)) != len(title_keys):
            raise ValueError("Duplicate title key")
        row_keys = [r.key for r in self.rows]
        if len(set(row_keys)) != len(row_keys):
            raise ValueError("Duplicate row key")
        known = set(title_keys)
        languages = set(self.languages)
        for r in self.rows:
            if r.title_key not in known:
                raise ValueError("A row names a title that is not in the request")
            if r.language not in languages:
                raise ValueError("A row is in a language that is not being searched")
        return self


class RunRequest(BaseModel):
    path: str = Field(max_length=4096)
    items: list[RunItem] = Field(min_length=1, max_length=5000)
    keep_existing: bool = False
    sync_after: bool = False
    engine: Literal["alass", "ffsubsync"] | None = None


def _require_existing_video(video_path: str) -> None:
    _require_video(video_path)
    if not os.path.isfile(video_path):
        raise SubtitleFileError(f"Video not found: {os.path.basename(video_path)}")


@router.post("/search", summary="Search the chosen sources for one video's subtitles")
def search_subtitles(body: SearchRequest):
    """Read-only: asks each source in `providers` for candidates in `languages` and returns them
    best first. A source that failed or does not apply to the title (YTS is films only) is an
    entry in `errors` naming it and why; the other sources' candidates are still returned.
    Results are cached for ten minutes."""
    _require_existing_video(body.video_path)
    ident = body.identity
    q = SearchQuery(
        identity=Identity(
            ident.title, ident.year, ident.type, ident.imdb_id, ident.tmdb_id, ident.subf2m_path
        ),
        languages=tuple(body.languages),
        season=body.season,
        episode=body.episode,
        video_path=body.video_path,
    )
    return subtitle_run.search_candidates(q, body.providers)


_SEARCH_LOCK = asyncio.Lock()


@router.post(
    "/searches",
    status_code=202,
    summary="Search a whole folder for subtitles in a background job",
)
async def start_search(body: SearchesRequest, db: Session = Depends(get_db)):
    """Queues the subtitle search job for a folder: every row (a video and a wanted language) is
    searched in the chosen sources, one at a time, with a retry after a dead connection. With
    `check_lengths` the best candidate of each row is compared with the video's runtime. With
    `save` the sure matches (a confirmed title, the exact episode, a fitting length) are also
    saved beside their videos; with it off, nothing is written. The results are kept on the job
    so the page can leave and come back. One search per folder at a time (409)."""

    def check() -> None:
        for video_path in dict.fromkeys(r.video_path for r in body.rows):
            _require_existing_video(video_path)

    await run_in_threadpool(check)  # a stat on a network mount must not block the event loop
    rows = {
        r.key: {
            "title_key": r.title_key,
            "video_path": r.video_path,
            "language": r.language,
            "season": r.season,
            "episode": r.episode,
            "state": "pending",
            "candidates": [],
            "errors": [],
            "length": None,
            "outcome": None,
            "reason": None,
            "detail": None,
            "saved": None,
        }
        for r in body.rows
    }
    settings = json.dumps(
        {
            "path": body.path,
            "providers": body.providers,
            "languages": body.languages,
            "scope": body.scope,
            "check_lengths": body.check_lengths,
            "save": body.save.model_dump() if body.save else None,
            "titles": [t.model_dump() for t in body.titles],
            "results": rows,
        }
    )
    # The check and the insert have no await between them, and sit under one lock besides, so
    # two quick requests for one folder make one job and one 409.
    async with _SEARCH_LOCK:
        if _search_running_for(db, body.path):
            raise HTTPException(409, "A search is already running for this folder")
        job = Job(
            type=JobType.SUBTITLE_SEARCH,
            status=JobStatus.PENDING,
            total_files=len(rows),
            settings=settings,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
    await enqueue(job.id, subtitle_search.run_subtitle_search_job, job.id)
    return {"job_id": job.id}


def _search_running_for(db: Session, folder: str) -> bool:
    active = (
        db.query(Job)
        .filter(
            Job.type == JobType.SUBTITLE_SEARCH,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
        .all()
    )
    for j in active:
        try:
            if json.loads(j.settings or "{}").get("path") == folder:
                return True
        except (ValueError, AttributeError):
            continue
    return False


@router.post("/run", summary="Download the approved subtitles in a background job")
async def run_subtitles(body: RunRequest, db: Session = Depends(get_db)):
    """Queues one job for the approved items. Each is downloaded and saved beside its video:
    as the plain `<name>.<lang>.srt` (replacing one, and removing that language's generated and
    translated files), or with `keep_existing` beside the existing one, labelled with its
    source. `sync_after` (or an item's own `sync`) syncs the saved file afterwards with `engine`
    (default: the Settings engine). Per-item results are stored on the job as it runs."""

    def check() -> None:
        for it in body.items:
            _require_existing_video(it.video_path)

    await run_in_threadpool(check)  # a stat on a network mount must not block the event loop
    items = [it.model_dump() for it in body.items]
    job = Job(
        type=JobType.SUBTITLE_DOWNLOAD,
        status=JobStatus.PENDING,
        total_files=len(items),
        settings=json.dumps(
            {
                "path": body.path,
                "items": items,
                "keep_existing": body.keep_existing,
                "sync_after": body.sync_after,
                "engine": body.engine,
            }
        ),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(
        job.id,
        subtitle_run.run_subtitle_job,
        job.id,
        items,
        body.keep_existing,
        body.sync_after,
        body.engine,
    )
    return {"job_id": job.id}


_ACTIVE_TYPES = (
    JobType.SUBTITLE_DOWNLOAD,
    JobType.SUBTITLE_SEARCH,
    JobType.SUBTITLE_SYNC,
    JobType.SUBTITLE_TRANSLATE,
    JobType.SUBTITLE_GENERATE,
)


@router.get("/active", summary="List running and waiting subtitle work by folder")
def active_work():
    """Every pending or running subtitle job (search, download, sync, translate, speech-to-text),
    grouped by the folder it was started from. `queue_position` is the job's place among all
    waiting jobs, only while every job slot is busy; otherwise null."""
    from app.database import SessionLocal
    from app.models.settings import get_setting

    db = SessionLocal()
    try:
        rows = (
            db.query(Job)
            .filter(
                Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
            )
            .order_by(Job.id)
            .all()
        )
        try:
            limit = int(get_setting(db, "max_concurrent_jobs", "1"))
        except ValueError:
            limit = 1
        running = sum(1 for j in rows if j.status == JobStatus.RUNNING)
        position: dict[int, int] = {}
        if running >= limit:
            pending = [j.id for j in rows if j.status == JobStatus.PENDING]
            position = {jid: n for n, jid in enumerate(pending, 1)}
        groups: dict[str, list[dict]] = {}
        for j in rows:
            if j.type not in _ACTIVE_TYPES:
                continue
            try:
                folder = json.loads(j.settings or "").get("path")
            except (ValueError, AttributeError):
                continue
            if not isinstance(folder, str) or not folder:
                continue
            groups.setdefault(folder, []).append(
                {
                    "id": j.id,
                    "type": j.type,
                    "status": j.status,
                    "progress": float(j.progress or 0.0),
                    "current_file": j.current_file,
                    "queue_position": position.get(j.id),
                }
            )
        return [{"path": p, "jobs": js} for p, js in groups.items()]
    finally:
        db.close()


def probe_duration(video_path: str) -> float | None:
    meta = scanner.probe_metadata(video_path)
    return meta.get("duration")


class PreviewRequest(BaseModel):
    video_path: str
    provider: str = Field(max_length=32)
    subtitle_id: str = Field(max_length=2000)
    language: str = Field(max_length=16)
    season: int | None = Field(default=None, ge=0, le=1000)
    episode: int | None = Field(default=None, ge=0, le=10000)


class ReleaseTokensRequest(BaseModel):
    release: str = Field(max_length=500)
    video_name: str = Field(max_length=500)


@router.post("/preview", summary="Download a subtitle candidate temporarily and describe it")
def preview_candidate(body: PreviewRequest):
    """Fetches the candidate into a temporary location (never beside the video) and returns its
    cue statistics, a sample of lines and a length hint against the video's runtime."""
    _require_video(body.video_path)
    if not os.path.isfile(body.video_path):
        raise SubtitleNotFound("That video does not exist.")
    duration = probe_duration(body.video_path)
    try:
        return subtitle_preview.create_preview(
            body.video_path,
            body.provider,
            body.subtitle_id,
            body.language,
            duration,
            season=body.season,
            episode=body.episode,
        )
    except ProviderError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=502)


class ExistingPreviewRequest(BaseModel):
    video_path: str
    subtitle_path: str


@router.post(
    "/existing-preview", summary="Describe a subtitle the video already has, as a temporary preview"
)
def preview_existing(body: ExistingPreviewRequest):
    """Same answer as the candidate preview, for one of the video's own subtitle files (a
    `.original` backup included). Served through the same temporary `.vtt` route; nothing is
    written beside the video."""
    _require_video(body.video_path)
    duration = probe_duration(body.video_path) if os.path.isfile(body.video_path) else None
    return subtitle_preview.create_existing_preview(body.video_path, body.subtitle_path, duration)


class UnmatchedPreviewRequest(BaseModel):
    root: str
    subtitle_path: str
    video_path: str | None = None


@router.post(
    "/unmatched/preview",
    summary="Describe a subtitle found beside no video, as a temporary preview",
)
def preview_unmatched(body: UnmatchedPreviewRequest):
    """For a stray subtitle of the folder `root` (checked against a fresh listing on the
    server). `video_path`, when it is an existing video, only supplies the length hint."""
    duration = None
    if body.video_path and os.path.isfile(body.video_path):
        _require_video(body.video_path)
        duration = probe_duration(body.video_path)
    return subtitle_preview.create_unmatched_preview(body.root, body.subtitle_path, duration)


@router.get("/preview/{preview_id}.vtt", summary="Serve a temporary preview as WebVTT")
def get_preview(preview_id: str):
    path = subtitle_preview.preview_path(preview_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(
        path,
        media_type="text/vtt",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/release-tokens", summary="Compare a release name with a video's file name")
def release_tokens(body: ReleaseTokensRequest):
    return subtitle_preview.release_tokens(body.release, body.video_name)
