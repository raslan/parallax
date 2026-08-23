import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/stream", tags=["stream"])


class PrepareRequest(BaseModel):
    path: str


@router.post("/prepare")
def prepare_stream(body: PrepareRequest):
    """Check whether a video needs an audio remux for browser playback, and
    kick one off in the background if so. Idempotent — safe to call repeatedly
    while polling. Used by VideoPlayerModal before it opens a player, so every
    Plyr-based preview across the app gets a progress indicator instead of a
    silent multi-minute hang on the first play of a non-web-safe file."""
    if not os.path.isfile(body.path):
        raise HTTPException(404, "File not found")
    from app.services.stream_cache import start_prepare
    return start_prepare(body.path)


@router.get("/prepare-status")
def prepare_status(path: str = Query(...)):
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    from app.services.stream_cache import needs_prepare
    return needs_prepare(path)
