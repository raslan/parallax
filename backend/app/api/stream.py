import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

router = APIRouter(prefix="/stream", tags=["stream"])


class PrepareRequest(BaseModel):
    path: str


@router.post("/prepare")
def prepare_stream(body: PrepareRequest):
    """Check whether a video needs its audio converted for browser playback, and plan an
    on-demand HLS stream if so. Idempotent — safe to call repeatedly while polling. Used by
    VideoPlayerModal before it opens a player: `mode` is `direct` (play the file as-is) or
    `hls` (play `url` once `status` is `ready`)."""
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


_MEDIA_TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".mp4": "video/mp4", ".m4s": "video/mp4"}


@router.get("/hls/{sid}/{name}")
def hls_file(sid: str, name: str):
    """Playlist, init segment, or media segment of the current HLS session. A segment that
    hasn't been converted yet is produced on request, so this can take a moment."""
    from app.services.stream_cache import hls_resource

    found = hls_resource(sid, name)
    if found is None:
        raise HTTPException(404, "Not found")
    kind, payload = found
    media_type = _MEDIA_TYPES[os.path.splitext(name)[1]]
    headers = {"Cache-Control": "no-store"}
    if kind == "bytes":
        return Response(payload, media_type=media_type, headers=headers)
    return FileResponse(payload, media_type=media_type, headers=headers)
