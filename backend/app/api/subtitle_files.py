"""Manage the subtitle files beside a video: list, rename, make main, delete, tidy up."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services import subtitle_files as svc
from app.services.subtitle_files import SubtitleFileError, SubtitleNotFound

router = APIRouter(prefix="/subtitles", tags=["subtitles"])


def subtitle_file_error_handler(request: Request | None, exc: SubtitleFileError) -> JSONResponse:
    """`SubtitleFileError` -> 400 (404 when the file is missing) + `{"detail": message}`."""
    status = 404 if isinstance(exc, SubtitleNotFound) else 400
    return JSONResponse({"detail": str(exc)}, status_code=status)


class UnmatchedRequest(BaseModel):
    path: str


class VideoRequest(BaseModel):
    video_path: str


class RenameRequest(BaseModel):
    video_path: str
    subtitle_path: str
    new_name: str


class MakeMainRequest(BaseModel):
    video_path: str
    subtitle_path: str


class DeleteRequest(BaseModel):
    video_path: str
    subtitle_paths: list[str] = Field(max_length=500)


class TidyRequest(BaseModel):
    video_paths: list[str] = Field(max_length=5000)
    what: str


@router.post("/unmatched", summary="List subtitle files in a folder that match no video")
def unmatched(body: UnmatchedRequest):
    return svc.unmatched_subtitles(body.path)


@router.post("/files", summary="List every subtitle file of a video")
def files(body: VideoRequest):
    return svc.list_subtitle_files(body.video_path)


@router.post("/rename", summary="Rename a subtitle file in its folder")
def rename(body: RenameRequest):
    return svc.rename_subtitle(body.video_path, body.subtitle_path, body.new_name)


@router.post("/make-main", summary="Swap a labelled subtitle with the plain main file")
def make_main(body: MakeMainRequest):
    return svc.make_main(body.video_path, body.subtitle_path)


@router.post("/delete", summary="Delete subtitle files of a video")
def delete(body: DeleteRequest):
    return {"deleted": svc.delete_subtitles(body.video_path, body.subtitle_paths)}


@router.post("/tidy", summary="Delete one family of subtitle files across videos")
def tidy(body: TidyRequest):
    return {"deleted": svc.tidy(body.video_paths, body.what)}
