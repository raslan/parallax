"""Kodi/XBMC .nfo generation — the metadata sidecar format both Jellyfin's
NFO feature and Plex's XBMCnfoTVImporter read. Used by Identify's custom-show
mode to give YouTube playlists a real Show experience without a TMDB entry.
"""

import json
import subprocess
import xml.etree.ElementTree as ET

_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
_STUDIO = "YouTube"


def normalize_date(raw: str | None) -> str | None:
    """Coerce an ffprobe date tag to YYYY-MM-DD, or None.

    Handles yt-dlp's embedded `date` (YYYYMMDD), ISO `creation_time`
    (2007-07-25T00:00:00.000000Z), and a bare YYYY-MM-DD.
    """
    if not raw:
        return None
    s = raw.strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None


def probe_date_and_plot(path: str) -> tuple[str | None, str | None]:
    """Read the upload date (YYYY-MM-DD) and description from a file's embedded
    container tags. Returns (None, None) if ffprobe fails or the tags are absent.

    Uses `-show_entries format_tags` (not `format=...,tags`): the latter does not
    expand the tags dict for Matroska, so an mkv's `DATE` tag would be missed.
    """
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        raw = json.loads(result.stdout).get("format", {}).get("tags", {}) if result.stdout else {}
    except Exception:
        raw = {}
    tags = {k.lower(): v for k, v in (raw or {}).items()}
    date = normalize_date(tags.get("date") or tags.get("creation_time"))
    plot = tags.get("description") or tags.get("synopsis") or tags.get("comment") or None
    return date, plot


def _render(root: ET.Element) -> str:
    ET.indent(root, space="  ")
    return _DECL + ET.tostring(root, encoding="unicode") + "\n"


def build_episode_nfo(
    *,
    title: str,
    show_title: str,
    season: int,
    episode: int,
    aired: str | None = None,
    plot: str | None = None,
) -> str:
    root = ET.Element("episodedetails")
    ET.SubElement(root, "title").text = title
    ET.SubElement(root, "showtitle").text = show_title
    ET.SubElement(root, "season").text = str(season)
    ET.SubElement(root, "episode").text = str(episode)
    if aired:
        ET.SubElement(root, "aired").text = aired
        ET.SubElement(root, "year").text = aired[:4]
    if plot:
        ET.SubElement(root, "plot").text = plot
    ET.SubElement(root, "studio").text = _STUDIO
    return _render(root)


def build_tvshow_nfo(
    *, title: str, premiered: str | None = None, with_artwork: bool = False
) -> str:
    root = ET.Element("tvshow")
    ET.SubElement(root, "title").text = title
    ET.SubElement(root, "showtitle").text = title
    if premiered:
        ET.SubElement(root, "premiered").text = premiered
        ET.SubElement(root, "year").text = premiered[:4]
    ET.SubElement(root, "studio").text = _STUDIO
    if with_artwork:
        ET.SubElement(root, "thumb", {"aspect": "poster"}).text = "poster.jpg"
        fanart = ET.SubElement(root, "fanart")
        ET.SubElement(fanart, "thumb").text = "backdrop.jpg"
    return _render(root)
