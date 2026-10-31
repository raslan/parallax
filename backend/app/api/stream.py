import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

router = APIRouter(prefix="/stream", tags=["stream"])


class PrepareRequest(BaseModel):
    path: str


@router.post("/prepare")
def prepare_stream(body: PrepareRequest):
    """Check whether a video needs its audio converted for browser playback, and start a
    live HLS run in the background if so. Idempotent — safe to call repeatedly while
    polling. Used by VideoPlayerModal before it opens a player: `mode` is `direct` (play the
    file as-is) or `hls` (play `url` once `status` is `playable`/`ready`)."""
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
    """Playlist, init segment, or media segment of the current HLS session."""
    from app.services.stream_cache import hls_file_path, read_playlist

    path = hls_file_path(sid, name)
    if path is None:
        raise HTTPException(404, "Not found")
    media_type = _MEDIA_TYPES[os.path.splitext(name)[1]]
    headers = {"Cache-Control": "no-store"}
    if name.endswith(".m3u8"):
        return Response(read_playlist(path), media_type=media_type, headers=headers)
    return FileResponse(path, media_type=media_type, headers=headers)
