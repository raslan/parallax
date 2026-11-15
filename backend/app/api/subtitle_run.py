"""Candidate preview and release-token comparison for the Subtitles page."""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.services import scanner, subtitle_preview
from app.services.subtitle_files import SubtitleNotFound, _require_video
from app.services.subtitle_providers import ProviderError

router = APIRouter(prefix="/subtitles", tags=["subtitles"])


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
