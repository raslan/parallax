import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting
from app.services import tmdb as tmdb_service
from app.services import renamer

router = APIRouter(prefix="/identify", tags=["identify"])


class SearchRequest(BaseModel):
    query: str
    type: Literal["movie", "tv"]


class SearchResult(BaseModel):
    tmdb_id: int
    title: str
    year: Optional[int] = None
    overview: str
    poster_path: Optional[str] = None
    type: str
    number_of_seasons: Optional[int] = None


class Episode(BaseModel):
    season_number: int = 1
    episode_number: int
    name: str
    overview: str


class FileMapping(BaseModel):
    file_path: str
    season_number: Optional[int] = None
    episode_number: Optional[int] = None
    episode_name: Optional[str] = None


class PreviewRequest(BaseModel):
    folder_path: str
    type: Literal["movie", "tv"]
    title: str
    year: Optional[int] = None
    tmdb_id: int
    mappings: list[FileMapping]


class RenameOp(BaseModel):
    old_path: str
    new_path: str


class PreviewResponse(BaseModel):
    file_ops: list[RenameOp]
    folder_ops: list[RenameOp]


class ApplyRequest(BaseModel):
    file_ops: list[RenameOp]
    folder_ops: list[RenameOp]


class ApplyResponse(BaseModel):
    successes: list[str]
    failures: list[dict]


def _api_key(db) -> str:
    key = get_setting(db, "tmdb_api_key", "")
    if not key:
        raise HTTPException(400, "TMDB API key not configured. Add it in Settings.")
    return key


@router.get("/files")
def list_files(path: str = Query(...), db: Session = Depends(get_db)):
    if not os.path.isdir(path):
        raise HTTPException(404, "Path not found or is not a directory")
    files = renamer.list_video_files(path)
    return {"path": path, "files": files}


@router.post("/search", response_model=list[SearchResult])
def search(body: SearchRequest, db: Session = Depends(get_db)):
    key = _api_key(db)
    try:
        return tmdb_service.search(body.query, body.type, key)
    except Exception as e:
        raise HTTPException(502, f"TMDB error: {e}")


@router.get("/tv/{tmdb_id}/episodes", response_model=list[Episode])
def get_all_episodes(tmdb_id: int, db: Session = Depends(get_db)):
    key = _api_key(db)
    try:
        return tmdb_service.get_all_episodes(tmdb_id, key)
    except Exception as e:
        raise HTTPException(502, f"TMDB error: {e}")


@router.get("/tv/{tmdb_id}/season/{season_number}", response_model=list[Episode])
def get_season(tmdb_id: int, season_number: int, db: Session = Depends(get_db)):
    key = _api_key(db)
    try:
        return tmdb_service.get_season(tmdb_id, season_number, key)
    except Exception as e:
        raise HTTPException(502, f"TMDB error: {e}")


@router.post("/preview", response_model=PreviewResponse)
def preview(body: PreviewRequest, db: Session = Depends(get_db)):
    tmdb_data = {
        "title": body.title,
        "year": body.year,
    }
    mappings = [
        {
            "file_path": m.file_path,
            "season_number": m.season_number,
            "episode_number": m.episode_number,
            "episode_name": m.episode_name,
        }
        for m in body.mappings
    ]
    file_ops, folder_ops = renamer.compute_ops(body.folder_path, body.type, tmdb_data, mappings)
    return PreviewResponse(
        file_ops=[RenameOp(**op) for op in file_ops],
        folder_ops=[RenameOp(**op) for op in folder_ops],
    )


@router.post("/apply", response_model=ApplyResponse)
def apply_renames(body: ApplyRequest, db: Session = Depends(get_db)):
    file_ops = [{"old_path": op.old_path, "new_path": op.new_path} for op in body.file_ops]
    folder_ops = [{"old_path": op.old_path, "new_path": op.new_path} for op in body.folder_ops]
    successes, failures = renamer.apply_ops(file_ops, folder_ops, db)
    return ApplyResponse(successes=successes, failures=failures)
