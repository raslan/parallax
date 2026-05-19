import requests
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

TMDB_BASE = "https://api.themoviedb.org/3"


def _fetch_tv_seasons(tmdb_id: int, api_key: str) -> int | None:
    try:
        r = requests.get(
            f"{TMDB_BASE}/tv/{tmdb_id}",
            params={"api_key": api_key},
            timeout=5,
        )
        r.raise_for_status()
        return r.json().get("number_of_seasons")
    except Exception:
        return None


def search(query: str, media_type: Literal["movie", "tv"], api_key: str) -> list[dict]:
    endpoint = "movie" if media_type == "movie" else "tv"
    r = requests.get(
        f"{TMDB_BASE}/search/{endpoint}",
        params={"query": query, "api_key": api_key, "language": "en-US", "page": 1},
        timeout=10,
    )
    r.raise_for_status()
    out = []
    for item in r.json().get("results", [])[:10]:
        title = item.get("title") or item.get("name", "")
        date = item.get("release_date") or item.get("first_air_date", "")
        year = int(date[:4]) if date and len(date) >= 4 else None
        out.append({
            "tmdb_id": item["id"],
            "title": title,
            "year": year,
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "type": media_type,
            "number_of_seasons": None,
        })

    if media_type == "tv" and out:
        with ThreadPoolExecutor(max_workers=5) as pool:
            seasons = list(pool.map(lambda x: _fetch_tv_seasons(x["tmdb_id"], api_key), out))
        for item, n in zip(out, seasons):
            item["number_of_seasons"] = n

    return out


def get_season(tmdb_id: int, season_number: int, api_key: str) -> list[dict]:
    r = requests.get(
        f"{TMDB_BASE}/tv/{tmdb_id}/season/{season_number}",
        params={"api_key": api_key, "language": "en-US"},
        timeout=10,
    )
    r.raise_for_status()
    return [
        {
            "episode_number": ep["episode_number"],
            "name": ep.get("name") or f"Episode {ep['episode_number']}",
            "overview": ep.get("overview", ""),
        }
        for ep in r.json().get("episodes", [])
    ]
