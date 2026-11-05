import pytest
import sqlalchemy as sa

from app.database import engine, init_db


@pytest.fixture
def clean_theme_rows():
    def wipe():
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM settings WHERE key IN ('theme', 'theme_ids_v2')"))

    init_db()  # make sure the settings table exists
    wipe()
    yield
    wipe()


def _put(key, value):
    with engine.begin() as conn:
        conn.execute(
            sa.text("INSERT INTO settings (key, value) VALUES (:k, :v)"),
            {"k": key, "v": value},
        )


def _get(key):
    with engine.connect() as conn:
        row = conn.execute(sa.text("SELECT value FROM settings WHERE key=:k"), {"k": key}).first()
    return row[0] if row else None


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ("parallax", "elegance"),
        ("nightfall", "parallax"),
        ("graphite", "graphite"),
        ("elegance", "elegance"),
    ],
)
def test_saved_theme_is_renamed_once(clean_theme_rows, before, after):
    _put("theme", before)
    init_db()
    assert _get("theme") == after
    assert _get("theme_ids_v2") == "1"


def test_migration_is_not_applied_twice(clean_theme_rows):
    # Old "nightfall" becomes the new "parallax"; a second init_db() must not make it "elegance".
    _put("theme", "nightfall")
    init_db()
    init_db()
    assert _get("theme") == "parallax"


def test_fresh_install_only_gets_the_marker(clean_theme_rows):
    init_db()
    assert _get("theme") is None
    assert _get("theme_ids_v2") == "1"
