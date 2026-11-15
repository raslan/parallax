import logging
import os
import re

from app.services import subtitle_names

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"}
SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa", ".vtt", ".sub"}

# Preferred order for browser-renderable subtitles
_BROWSER_SUB_EXTS = [".srt", ".vtt", ".ass", ".ssa", ".sub"]


def _parse_lang(code: str) -> tuple[str, str]:
    """Return (iso_code, display_name) from a language code string."""
    if not code:
        return "und", "Subtitles"
    try:
        from babelfish import Language

        lang = Language.fromalpha2(code) if len(code) == 2 else Language(code)
        return str(lang.alpha2 or code), lang.name
    except Exception:
        return code, code.title()


def _subtitle_search_dirs(video_path: str) -> list[str]:
    """Video's own dir plus every subdirectory beneath it, recursively —
    same as how video scanning recurses, no hardcoded folder names."""
    video_dir = os.path.dirname(video_path)
    return [dirpath for dirpath, _, _ in os.walk(video_dir)]


def find_subtitle_path(video_path: str) -> str | None:
    """The subtitle the player should show by default, or None. A `.original` sync backup is
    never served; a plain real subtitle wins over a labelled real one, which wins over a
    machine-made one (generated/translated). Ties go to the video's own folder, then the
    browser-friendliest extension, then the name."""
    stem = os.path.splitext(os.path.basename(video_path))[0]
    best: tuple | None = None
    for di, d in enumerate(_subtitle_search_dirs(video_path)):
        for ei, ext in enumerate(_BROWSER_SUB_EXTS):
            exact = os.path.join(d, stem + ext)
            if os.path.exists(exact):
                key = (0, di, ei, exact)
                best = key if best is None or key < best else best
        for path, tag in _tagged_files(video_path, [d]):
            if tag.original:
                continue
            ext = os.path.splitext(path)[1].lower()
            rank = (
                2 if tag.machine_made else (0 if not tag.label and not tag.hearing_impaired else 1)
            )
            key = (rank, di, _BROWSER_SUB_EXTS.index(ext), path)
            best = key if best is None or key < best else best
    return best[3] if best else None


def find_all_subtitle_tracks(
    video_path: str, dirs_cache: dict[str, list[str]] | None = None
) -> list[dict]:
    """Return all subtitle files for the video with language metadata. `dirs_cache` (folder ->
    search dirs) lets a caller covering many videos walk each distinct folder once."""
    import glob as _glob

    stem = os.path.splitext(os.path.basename(video_path))[0]
    seen: set[str] = set()
    tracks = []

    video_dir = os.path.dirname(video_path)
    if dirs_cache is None:
        search_dirs = _subtitle_search_dirs(video_path)
    else:
        if video_dir not in dirs_cache:
            dirs_cache[video_dir] = _subtitle_search_dirs(video_path)
        search_dirs = dirs_cache[video_dir]

    for d in search_dirs:
        base = os.path.join(d, stem)
        for ext in _BROWSER_SUB_EXTS:
            exact = base + ext
            if os.path.exists(exact) and exact not in seen:
                seen.add(exact)
                tracks.append(
                    {
                        "path": exact,
                        "lang": "und",
                        "label": "Subtitles",
                        "hearing_impaired": False,
                        "machine_made": False,
                        "kind": "real",
                    }
                )

            for m in sorted(_glob.glob(f"{_glob.escape(base)}.*{ext}")):
                if m in seen:
                    continue
                seen.add(m)
                # Extract the part between basename and extension (e.g. "en" from "movie.en.srt")
                tag = subtitle_names.parse_tag(m[len(base) + 1 : -len(ext)])
                if tag.original:  # a sync backup, never a track
                    continue
                lang, label = _parse_lang(tag.lang)
                notes = [
                    n
                    for n in (
                        "hearing impaired" if tag.hearing_impaired else None,
                        tag.machine_kind,
                        tag.label,
                    )
                    if n
                ]
                tracks.append(
                    {
                        "path": m,
                        "lang": lang,
                        "label": f"{label} ({', '.join(notes)})" if notes else label,
                        "hearing_impaired": tag.hearing_impaired,
                        "machine_made": tag.machine_made,
                        "kind": tag.kind,
                    }
                )

    return tracks


def subtitle_to_vtt(sub_path: str) -> str:
    """Read a subtitle file and return its content as WebVTT."""

    from app.services.srt_io import decode_srt

    with open(sub_path, "rb") as f:
        content = decode_srt(f.read())
    ext = os.path.splitext(sub_path)[1].lower()
    if ext == ".vtt":
        return content
    if ext == ".srt":
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        content = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", content)
        return "WEBVTT\n\n" + content
    # .ass/.ssa/.sub — not natively renderable; return empty VTT
    return "WEBVTT\n\n"


def find_and_serve_vtt(video_path: str) -> str | None:
    """Find subtitle alongside video and return as VTT string, or None if absent."""
    sub = find_subtitle_path(video_path)
    return subtitle_to_vtt(sub) if sub else None


def _tagged_files(
    video_path: str, search_dirs: list[str] | None = None
) -> list[tuple[str, subtitle_names.SubTag]]:
    """Every subtitle file of this video that carries a language tag, with its parsed tag:
    `<stem>.<lang>[.hi][.<token>].<ext>` in the video's folder or any folder below it. The stem
    must match exactly (`stem + "."`), never as a prefix of another video's name."""
    stem = os.path.splitext(os.path.basename(video_path))[0]
    prefix = stem + "."
    found = []
    for d in search_dirs if search_dirs is not None else _subtitle_search_dirs(video_path):
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for name in names:
            if name.startswith("."):  # hidden: our own temp files, never a subtitle
                continue
            base, ext = os.path.splitext(name)
            if ext.lower() in SUBTITLE_EXTENSIONS and base.startswith(prefix):
                found.append((os.path.join(d, name), subtitle_names.parse_tag(base[len(prefix) :])))
    return found


def remove_machine_made(video_path: str, language: str) -> bool:
    """A real subtitle for `language` just arrived: the generated and translated files of that
    language are no longer needed. Returns whether a file was removed."""
    lang = language.lower()
    candidates = [
        path
        for path, t in _tagged_files(video_path)
        if t.lang == lang and not t.original and t.machine_made
    ]
    for path in candidates:
        os.remove(path)
    return bool(candidates)


def scan_directory(root_path: str) -> list[dict]:
    """Walk directory and return its video files with the subtitle files beside each."""
    from guessit import guessit as _guessit

    from app.services.subtitle_files import list_subtitle_files

    results = []
    dirs_cache: dict[str, list[str]] = {}  # one tree walk per distinct video folder
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames.sort()
        for fname in sorted(filenames):
            if os.path.splitext(fname)[1].lower() not in VIDEO_EXTENSIONS:
                continue

            full_path = os.path.join(dirpath, fname)
            rel_dir = os.path.relpath(dirpath, root_path)

            info = _guessit(fname)
            results.append(
                {
                    "path": full_path,
                    "filename": fname,
                    "relative_dir": "" if rel_dir == "." else rel_dir,
                    "subtitles": list_subtitle_files(full_path, dirs_cache),
                    "title": str(info.get("title", "")),
                    "season": info.get("season"),
                    "episode": info.get("episode"),
                    "year": info.get("year"),
                    "media_type": info.get("type", "unknown"),
                }
            )

    return results
