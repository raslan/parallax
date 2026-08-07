import os
import re

from app.models.file import File
from app.models.library import Library
from app.services.scanner import VIDEO_EXTENSIONS
from app.services.subtitle_service import SUBTITLE_EXTENSIONS


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
    """Return sorted list of absolute paths to video files inside folder_path (recursive)."""
    results = []
    try:
        for dirpath, _dirs, filenames in os.walk(folder_path):
            for name in filenames:
                if os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS:
                    results.append(os.path.join(dirpath, name))
    except (PermissionError, FileNotFoundError, NotADirectoryError):
        return []
    return sorted(results, key=lambda p: p.lower())


def guess_media(folder_path: str, files: list[str]) -> dict:
    """Best-effort guess of title/year/type for a folder, to prefill the TMDB
    search box before the user corrects it. Guesses off the folder name first
    (usually the cleanest signal — release-group junk lives in filenames, not
    folder names). If the folder name yields a title but not a TV show indicator,
    checks the first file's type to see if it's an episode. Falls back to the
    first video file if the folder name is too generic (e.g. "Season 1", "New folder")."""
    from guessit import guessit as _guessit

    folder_name = os.path.basename(os.path.normpath(folder_path))
    info = _guessit(folder_name)
    # If folder guess isn't marked as episode, check if files are episodes
    if files and info.get("type") != "episode":
        file_info = _guessit(os.path.basename(files[0]))
        if file_info.get("type") == "episode":
            # Files are episodes but folder name didn't indicate it; use file's type
            # but preserve folder's title if it exists (it's usually cleaner than filename)
            info = {**file_info, "title": info.get("title") or file_info.get("title")}
    # Fallback: if folder name was too generic to yield a title, try the first file
    if not info.get("title") and files:
        info = _guessit(os.path.basename(files[0]))

    return {
        "title": str(info.get("title", "")),
        "year": info.get("year"),
        "type": "tv" if info.get("type") == "episode" else "movie",
    }


def guess_file_episodes(files: list[str]) -> list[dict]:
    """Per-file season/episode guess — unlike guess_media, which only looks at
    the folder name once, this runs guessit on every individual filename so
    files can be auto-placed into the correct episode slot regardless of what
    order they were listed in or what season the folder itself suggests.
    A file guessit can't confidently parse gets season/episode both None, so
    the caller can fall back to leaving it for manual placement."""
    from guessit import guessit as _guessit

    results = []
    for fp in files:
        info = _guessit(os.path.basename(fp))
        season = info.get("season")
        episode = info.get("episode")
        # guessit returns a list for multi-episode releases (e.g. "S01E01E02")
        # instead of a plain int — take the first value rather than choking.
        if isinstance(season, list):
            season = season[0] if season else None
        if isinstance(episode, list):
            episode = episode[0] if episode else None
        results.append({
            "file_path": fp,
            "season": season,
            "episode": episode,
        })
    return results


def find_subtitle_files(video_path: str) -> list[str]:
    """Return subtitle files alongside video_path sharing its base name, e.g.
    "episode1.srt" or "episode1.en.srt" next to "episode1.mp4"."""
    directory = os.path.dirname(video_path)
    stem = os.path.splitext(os.path.basename(video_path))[0]
    results = []
    try:
        for name in os.listdir(directory):
            if os.path.splitext(name)[1].lower() not in SUBTITLE_EXTENSIONS:
                continue
            name_stem = os.path.splitext(name)[0]
            if name_stem == stem or name_stem.startswith(stem + "."):
                results.append(os.path.join(directory, name))
    except (PermissionError, FileNotFoundError, NotADirectoryError):
        pass
    return results


def _subtitle_ops(fp: str, new_video_path: str) -> list[dict]:
    """Rename any subtitle files matching fp's base name to follow new_video_path,
    preserving a language tag suffix (e.g. ".en") if present."""
    stem = os.path.splitext(os.path.basename(fp))[0]
    new_stem = os.path.splitext(new_video_path)[0]
    ops = []
    for sub_path in find_subtitle_files(fp):
        sub_ext = os.path.splitext(sub_path)[1]
        sub_stem = os.path.splitext(os.path.basename(sub_path))[0]
        suffix = sub_stem[len(stem):]
        new_sub_path = new_stem + suffix + sub_ext
        if os.path.abspath(sub_path) != os.path.abspath(new_sub_path):
            ops.append({"old_path": sub_path, "new_path": new_sub_path})
    return ops


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
            file_ops.extend(_subtitle_ops(fp, new_path))

        new_folder = os.path.join(parent, movie_folder_name(title, year))
        if abs_folder != os.path.abspath(new_folder):
            folder_ops.append({"old_path": folder_path, "new_path": new_folder})

    else:  # tv
        for m in mappings:
            fp = m.get("file_path", "")
            ep_num = m.get("episode_number")
            ep_name = m.get("episode_name") or f"Episode {ep_num}"
            season = m.get("season_number") or 1
            if not fp:
                continue
            if ep_num is None:
                unmatched_dir = os.path.join(abs_folder, "Unmatched")
                new_path = os.path.join(unmatched_dir, os.path.basename(fp))
                if os.path.abspath(fp) != os.path.abspath(new_path):
                    file_ops.append({"old_path": fp, "new_path": new_path})
                file_ops.extend(_subtitle_ops(fp, new_path))
                continue
            ext = os.path.splitext(fp)[1].lower()
            season_dir = os.path.join(abs_folder, tv_season_folder_name(season))
            new_path = os.path.join(season_dir, tv_file_name(title, season, ep_num, ep_name, ext))
            if os.path.abspath(fp) != os.path.abspath(new_path):
                file_ops.append({"old_path": fp, "new_path": new_path})
            file_ops.extend(_subtitle_ops(fp, new_path))

        new_folder = os.path.join(parent, safe_name(title))
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
            os.makedirs(os.path.dirname(op["new_path"]), exist_ok=True)
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
