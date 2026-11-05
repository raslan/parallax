"""credits.json is the single source for Settings → Credits and the docs site's Acknowledgements."""

import json
import re
from pathlib import Path

import pytest

from app.api.credits import get_credits
from app.services import credits as credits_service
from app.services import upscale_models as um

# The public site never names these tools; entries visible there must not mention them.
FORBIDDEN_ON_SITE = re.compile(r"yt[-_]?dlp|ytdl|youtube[-_]?dl|gallery[-_]?dl", re.IGNORECASE)

REQUIRED = ("id", "group", "name", "description", "author", "licence", "licence_url", "url", "how")


@pytest.fixture(scope="module")
def data() -> dict:
    return credits_service.load_credits()


def test_every_entry_has_the_required_fields(data):
    for e in data["entries"]:
        missing = [k for k in REQUIRED if not e.get(k)]
        assert not missing, f"{e.get('id')}: missing {missing}"
        assert set(e["show"]) == {"app", "site"}, e["id"]
        assert e["how"] in credits_service.HOW_VALUES, e["id"]
        assert e["licence_url"].startswith("https://"), e["id"]
        assert e["url"].startswith("https://"), e["id"]


def test_ids_are_unique_and_groups_exist(data):
    ids = [e["id"] for e in data["entries"]]
    assert len(ids) == len(set(ids))
    groups = {g["id"] for g in data["groups"]}
    assert len(groups) == len(data["groups"])
    assert {e["group"] for e in data["entries"]} <= groups


def test_nothing_is_hidden_everywhere(data):
    assert all(e["show"]["app"] or e["show"]["site"] for e in data["entries"])


def test_every_bundled_upscale_model_is_credited(data):
    credited = {e["name"]: e for e in data["entries"] if e["group"] == "upscaling"}
    for tier in um.list_tiers():
        assert tier.model in credited, f"{tier.model} is bundled but has no credit"
        assert credited[tier.model]["how"] == "shipped"
    assert "ncnn" in credited and credited["ncnn"].get("text")


def test_site_entries_do_not_name_the_download_tools(data):
    for e in data["entries"]:
        if e["show"]["site"]:
            assert not FORBIDDEN_ON_SITE.search(json.dumps(e)), f"{e['id']} is on the site"


def test_tool_entries_are_app_only(data):
    for e in data["entries"]:
        if FORBIDDEN_ON_SITE.search(e["name"]):
            assert e["show"] == {"app": True, "site": False}, e["id"]


def test_tmdb_has_the_required_notice_and_logo(data):
    tmdb = next(e for e in data["entries"] if e["id"] == "tmdb")
    assert tmdb["notice"].startswith("This product uses TMDB and the TMDB APIs")
    assert tmdb["logo"].startswith("https://www.themoviedb.org/")
    assert tmdb["show"] == {"app": True, "site": True}


def test_scopes_filter_entries_and_drop_empty_groups():
    app = credits_service.credits_for("app")
    site = credits_service.credits_for("site")
    assert any(e["id"] == "ytdlp" for e in app["entries"])
    assert not any(e["id"] == "ytdlp" for e in site["entries"])
    assert not any(e["id"].startswith("demo-") for e in app["entries"])
    assert any(e["id"].startswith("demo-") for e in site["entries"])
    for scope in (app, site):
        used = {e["group"] for e in scope["entries"]}
        assert {g["id"] for g in scope["groups"]} == used


def test_route_serves_the_app_scope():
    assert get_credits() == credits_service.credits_for("app")


def test_file_is_where_the_site_expects_it():
    assert (Path(credits_service.ASSETS_DIR) / "credits.json").is_file()
