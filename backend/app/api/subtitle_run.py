"""Plan search, candidate preview, release-token comparison and the approved-items run job for
the Subtitles page."""

import json
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.job import Job, JobStatus, JobType
from app.queue import enqueue
from app.services import scanner, subtitle_preview, subtitle_run
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
    imdb_id: str | None = Field(default=None, max_length=20)
    tmdb_id: int | None = None


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

    @field_validator("provider")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in known_providers():
            raise ValueError("Unknown source")
        return v


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
        identity=Identity(ident.title, ident.year, ident.type, ident.imdb_id, ident.tmdb_id),
        languages=tuple(body.languages),
        season=body.season,
        episode=body.episode,
        video_path=body.video_path,
    )
    return subtitle_run.search_candidates(q, body.providers)


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


def probe_duration(video_path: str) -> float | None:
    meta = scanner.probe_metadata(video_path)
    return meta.get("duration")


class PreviewRequest(BaseModel):
    video_path: str
    provider: str = Field(max_length=32)
    subtitle_id: str = Field(max_length=2000)
    language: str = Field(max_length=16)


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
            body.video_path, body.provider, body.subtitle_id, body.language, duration
        )
    except ProviderError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=502)


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
