import os
import re

from app.models.file import File
from app.models.library import Library
from app.services.scanner import VIDEO_EXTENSIONS


def safe_name(s: str) -> str:
    """Strip chars invalid in filenames on Windows/Linux/macOS."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", s)
    return cleaned.strip(". ")


def movie_file_name(title: str, year: int | None, ext: str) -> str:
    suffix = f" ({year})" if year else ""
    return f"{safe_name(title)}{suffix}{ext}"


def movie_folder_name(title: str, year: int | None) -> str:
    suffix = f" ({year})" if year else ""
    return f"{safe_name(title)}{suffix}"


def tv_file_name(show: str, season: int, episode: int, ep_title: str, ext: str) -> str:
    return f"{safe_name(show)} - S{season:02d}E{episode:02d} - {safe_name(ep_title)}{ext}"


def tv_season_folder_name(season: int) -> str:
    return f"Season {season:02d}"


def list_video_files(folder_path: str) -> list[str]:
    """Return sorted list of absolute paths to video files directly inside folder_path."""
    try:
        entries = sorted(os.scandir(folder_path), key=lambda e: e.name.lower())
        return [
            e.path for e in entries
            if e.is_file() and os.path.splitext(e.name)[1].lower() in VIDEO_EXTENSIONS
        ]
    except (PermissionError, FileNotFoundError, NotADirectoryError):
        return []


def compute_ops(
    folder_path: str,
    media_type: str,
    tmdb_data: dict,
    mappings: list[dict],
) -> tuple[list[dict], list[dict]]:
    """
    Compute file and folder rename operations without touching the filesystem.

    tmdb_data: {"title": str, "year": int|None, "season_number": int|None}
    mappings: [{"file_path": str, "episode_number": int|None, "episode_name": str|None}]

    Returns (file_ops, folder_ops). Each op: {"old_path": str, "new_path": str}.
    File ops must be applied before folder ops.
    """
    file_ops: list[dict] = []
    folder_ops: list[dict] = []
    title = tmdb_data["title"]
    year = tmdb_data.get("year")
    abs_folder = os.path.abspath(folder_path)
    parent = os.path.dirname(abs_folder)

    if media_type == "movie":
        for m in mappings:
            fp = m.get("file_path", "")
            if not fp:
                continue
            ext = os.path.splitext(fp)[1].lower()
            new_path = os.path.join(abs_folder, movie_file_name(title, year, ext))
            if os.path.abspath(fp) != os.path.abspath(new_path):
                file_ops.append({"old_path": fp, "new_path": new_path})

        new_folder = os.path.join(parent, movie_folder_name(title, year))
        if abs_folder != os.path.abspath(new_folder):
            folder_ops.append({"old_path": folder_path, "new_path": new_folder})

    else:  # tv
        season = tmdb_data.get("season_number") or 1
        for m in mappings:
            fp = m.get("file_path", "")
            ep_num = m.get("episode_number")
            ep_name = m.get("episode_name") or f"Episode {ep_num}"
            if not fp or ep_num is None:
                continue
            ext = os.path.splitext(fp)[1].lower()
            new_path = os.path.join(abs_folder, tv_file_name(title, season, ep_num, ep_name, ext))
            if os.path.abspath(fp) != os.path.abspath(new_path):
                file_ops.append({"old_path": fp, "new_path": new_path})

        new_folder = os.path.join(parent, safe_name(title), tv_season_folder_name(season))
        if abs_folder != os.path.abspath(new_folder):
            folder_ops.append({"old_path": folder_path, "new_path": new_folder})

    return file_ops, folder_ops


def apply_ops(
    file_ops: list[dict],
    folder_ops: list[dict],
    db,
) -> tuple[list[str], list[dict]]:
    """
    Execute rename operations in order: files first, then folders.
    Updates File.path, File.filename, and Library.path in the DB.
    Returns (successes, failures).
    """
    successes: list[str] = []
    failures: list[dict] = []

    for op in file_ops:
        try:
            os.rename(op["old_path"], op["new_path"])
            f = db.query(File).filter(File.path == op["old_path"]).first()
            if f:
                f.path = op["new_path"]
                f.filename = os.path.basename(op["new_path"])
            successes.append(op["old_path"])
        except OSError as e:
            failures.append({"path": op["old_path"], "error": str(e)})
    db.commit()

    for op in folder_ops:
        try:
            parent_dir = os.path.dirname(op["new_path"])
            os.makedirs(parent_dir, exist_ok=True)
            os.rename(op["old_path"], op["new_path"])

            old_prefix = op["old_path"].rstrip("/") + "/"
            new_prefix = op["new_path"].rstrip("/") + "/"
            for f in db.query(File).filter(File.path.like(old_prefix + "%")).all():
                f.path = new_prefix + f.path[len(old_prefix):]

            lib = db.query(Library).filter(Library.path == op["old_path"]).first()
            if lib:
                lib.path = op["new_path"]

            successes.append(op["old_path"])
        except OSError as e:
            failures.append({"path": op["old_path"], "error": str(e)})
    db.commit()

    return successes, failures
