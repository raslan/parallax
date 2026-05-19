import requests
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

TMDB_BASE = "https://api.themoviedb.org/3"


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
            "number_of_seasons": item.get("number_of_seasons"),
        })
    return out


def get_all_episodes(tmdb_id: int, api_key: str) -> list[dict]:
    """Fetch every episode across all seasons in parallel."""
    r = requests.get(
        f"{TMDB_BASE}/tv/{tmdb_id}",
        params={"api_key": api_key, "language": "en-US"},
        timeout=10,
    )
    r.raise_for_status()
    n_seasons = r.json().get("number_of_seasons") or 1

    def fetch_season(n: int) -> list[dict]:
        try:
            sr = requests.get(
                f"{TMDB_BASE}/tv/{tmdb_id}/season/{n}",
                params={"api_key": api_key, "language": "en-US"},
                timeout=10,
            )
            sr.raise_for_status()
            return [
                {
                    "season_number": n,
                    "episode_number": ep["episode_number"],
                    "name": ep.get("name") or f"Episode {ep['episode_number']}",
                    "overview": ep.get("overview", ""),
                }
                for ep in sr.json().get("episodes", [])
            ]
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=5) as pool:
        seasons = list(pool.map(fetch_season, range(1, n_seasons + 1)))

    return [ep for season in seasons for ep in season]


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
