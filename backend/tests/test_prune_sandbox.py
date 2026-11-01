import os

import pytest

from app.services.prune_sandbox import (
    SandboxError,
    is_hidden,
    kind_of,
    resolve_inside,
    validate_root,
)


@pytest.fixture
def root(tmp_path):
    r = tmp_path / "root"
    r.mkdir()
    (r / "a.txt").write_text("x")
    (r / "sub").mkdir()
    return str(r)


def test_inside_path_ok(root):
    p = os.path.join(root, "sub")
    assert resolve_inside(root, p) == os.path.realpath(p)


def test_dotdot_escape_rejected(root, tmp_path):
    (tmp_path / "outside").mkdir()
    with pytest.raises(SandboxError) as e:
        resolve_inside(root, os.path.join(root, "..", "outside"))
    assert e.value.status == 403


def test_symlink_pointing_outside_rejected(root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, os.path.join(root, "link"))
    with pytest.raises(SandboxError) as e:
        resolve_inside(root, os.path.join(root, "link"))
    assert e.value.status == 403


def test_sibling_prefix_not_inside(root, tmp_path):
    evil = tmp_path / "root-evil"
    evil.mkdir()
    with pytest.raises(SandboxError) as e:
        resolve_inside(root, str(evil))
    assert e.value.status == 403


def test_missing_is_404(root):
    with pytest.raises(SandboxError) as e:
        resolve_inside(root, os.path.join(root, "nope"))
    assert e.value.status == 404


def test_root_itself_allowed_for_listing_but_flagged(root):
    assert resolve_inside(root, root) == os.path.realpath(root)


def test_validate_root_rejects_slash_and_file(root):
    with pytest.raises(SandboxError) as e:
        validate_root("/")
    assert e.value.status == 400
    with pytest.raises(SandboxError) as e:
        validate_root(os.path.join(root, "a.txt"))
    assert e.value.status == 400
    with pytest.raises(SandboxError) as e:
        validate_root(os.path.join(root, "missing"))
    assert e.value.status == 400
    assert validate_root(root) == os.path.realpath(root)


def test_kind_of_uses_scanner_sets():
    assert kind_of("a.mkv") == "video"
    assert kind_of("a.MKV") == "video"
    assert kind_of("a.flac") == "audio"
    assert kind_of("a.jpg") == "image"
    assert kind_of("a.JPG") == "image"
    assert kind_of("a.txt") == "other"
    assert kind_of("noext") == "other"


def test_is_hidden():
    assert is_hidden(".git")
    assert is_hidden(".hidden.mkv")
    assert not is_hidden("a.mkv")
