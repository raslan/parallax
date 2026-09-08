import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting
from app.services import nfo, renamer
from app.services import tmdb as tmdb_service

router = APIRouter(prefix="/identify", tags=["identify"])

_thumb_cache: dict[str, bytes] = {}


class SearchRequest(BaseModel):
    query: str
    type: Literal["movie", "tv"]


class SearchResult(BaseModel):
    tmdb_id: int
    title: str
    year: int | None = None
    overview: str
    poster_path: str | None = None
    type: str
    number_of_seasons: int | None = None


class Episode(BaseModel):
    season_number: int = 1
    episode_number: int
    name: str
    overview: str
    still_path: str | None = None


class FileMapping(BaseModel):
    file_path: str
    season_number: int | None = None
    episode_number: int | None = None
    episode_name: str | None = None


class PreviewRequest(BaseModel):
    folder_path: str
    type: Literal["movie", "tv"]
    title: str
    year: int | None = None
    tmdb_id: int | None = None
    mappings: list[FileMapping]
    target_dir: str | None = None
    write_nfo: bool = False


class RenameOp(BaseModel):
    old_path: str
    new_path: str


class NfoOp(BaseModel):
    path: str
    content: str


class PreviewResponse(BaseModel):
    file_ops: list[RenameOp]
    folder_ops: list[RenameOp]
    nfo_ops: list[NfoOp] = []


class ApplyRequest(BaseModel):
    file_ops: list[RenameOp]
    folder_ops: list[RenameOp]
    nfo_ops: list[NfoOp] = []


class ApplyResponse(BaseModel):
    successes: list[str]
    failures: list[dict]


def _api_key(db) -> str:
    key = get_setting(db, "tmdb_api_key", "")
    if not key:
        raise HTTPException(400, "TMDB API key not configured. Add it in Settings.")
    return key


@router.get("/thumbnail")
def get_thumbnail(path: str = Query(...)):
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    if path in _thumb_cache:
        return Response(
            _thumb_cache[path], media_type="image/jpeg", headers={"Cache-Control": "no-store"}
        )
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                "00:00:05",
                "-i",
                path,
                "-vframes",
                "1",
                "-vf",
                "scale=160:-1",
                tmp_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        )
        with open(tmp_path, "rb") as f:
            data = f.read()
    except Exception:
        raise HTTPException(502, "Failed to extract thumbnail")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    if not data:
        raise HTTPException(502, "Empty thumbnail")
    if len(_thumb_cache) < 200:
        _thumb_cache[path] = data
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/files")
def list_files(path: str = Query(...), db: Session = Depends(get_db)):
    if not os.path.isdir(path):
        raise HTTPException(404, "Path not found or is not a directory")
    files = renamer.list_video_files(path)
    guess = renamer.guess_media(path, files)
    file_guesses = renamer.guess_file_episodes(files)
    return {"path": path, "files": files, "guess": guess, "file_guesses": file_guesses}


@router.get("/file-dates")
def file_dates(path: str = Query(...)):
    """Map each video file in `path` to its embedded upload date (YYYY-MM-DD) or
    null. Read lazily by Identify's custom-show "sort by upload date" — one
    ffprobe per file, so it's a separate call from /files."""
    if not os.path.isdir(path):
        raise HTTPException(404, "Path not found or is not a directory")
    files = renamer.list_video_files(path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        dates = pool.map(lambda f: nfo.probe_date_and_plot(f)[0], files)
    return dict(zip(files, dates, strict=True))


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
    if body.target_dir and not os.path.isdir(body.target_dir):
        raise HTTPException(400, "Target folder not found or is not a directory")
    file_ops, folder_ops = renamer.compute_ops(
        body.folder_path, body.type, tmdb_data, mappings, body.target_dir
    )
    nfo_ops = _build_nfo_ops(body, file_ops, folder_ops) if body.write_nfo else []
    return PreviewResponse(
        file_ops=[RenameOp(**op) for op in file_ops],
        folder_ops=[RenameOp(**op) for op in folder_ops],
        nfo_ops=nfo_ops,
    )


def _build_nfo_ops(
    body: PreviewRequest, file_ops: list[dict], folder_ops: list[dict]
) -> list[NfoOp]:
    """Generate .nfo sidecars whose paths already point at the final (post-move)
    location, so apply just writes them verbatim."""
    abs_folder = os.path.abspath(body.folder_path)
    show_folder = folder_ops[0]["new_path"] if folder_ops else abs_folder
    renamed = {os.path.abspath(op["old_path"]): op["new_path"] for op in file_ops}

    def final_video_path(src: str) -> str:
        p = renamed.get(os.path.abspath(src), os.path.abspath(src))
        if folder_ops and p.startswith(abs_folder + os.sep):
            p = show_folder + p[len(abs_folder) :]
        return p

    eps = [m for m in body.mappings if m.episode_number is not None]
    with ThreadPoolExecutor(max_workers=8) as pool:
        probed = list(pool.map(lambda m: nfo.probe_date_and_plot(m.file_path), eps))

    ops: list[NfoOp] = []
    dates: list[str] = []
    for m, (aired, plot) in zip(eps, probed, strict=True):
        if aired:
            dates.append(aired)
        nfo_path = os.path.splitext(final_video_path(m.file_path))[0] + ".nfo"
        ops.append(
            NfoOp(
                path=nfo_path,
                content=nfo.build_episode_nfo(
                    title=m.episode_name or f"Episode {m.episode_number}",
                    show_title=body.title,
                    season=m.season_number or 1,
                    episode=m.episode_number,
                    aired=aired,
                    plot=plot,
                ),
            )
        )

    ops.insert(
        0,
        NfoOp(
            path=os.path.join(show_folder, "tvshow.nfo"),
            content=nfo.build_tvshow_nfo(title=body.title, premiered=min(dates) if dates else None),
        ),
    )
    return ops


@router.post("/apply", response_model=ApplyResponse)
def apply_renames(body: ApplyRequest, db: Session = Depends(get_db)):
    file_ops = [{"old_path": op.old_path, "new_path": op.new_path} for op in body.file_ops]
    folder_ops = [{"old_path": op.old_path, "new_path": op.new_path} for op in body.folder_ops]
    nfo_ops = [{"path": op.path, "content": op.content} for op in body.nfo_ops]
    successes, failures = renamer.apply_ops(file_ops, folder_ops, db, nfo_ops)
    return ApplyResponse(successes=successes, failures=failures)
