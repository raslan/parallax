import os

import app.services.common as common


def test_temp_sibling_path_uses_source_dir_when_scratch_not_mounted(monkeypatch, tmp_path):
    monkeypatch.setattr(common, "SCRATCH_DIR", str(tmp_path / "does-not-exist"))

    src = str(tmp_path / "movie.mp4")
    result = common.temp_sibling_path(src, ".mp4", "compressing")

    assert os.path.dirname(result) == str(tmp_path)
    assert os.path.basename(result).startswith(".compressing-")
    assert result.endswith(".mp4")


def test_temp_sibling_path_uses_scratch_dir_when_mounted(monkeypatch, tmp_path):
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(common, "SCRATCH_DIR", str(scratch))

    src = str(tmp_path / "media" / "movie.mp4")
    result = common.temp_sibling_path(src, ".mp4", "compressing")

    assert os.path.dirname(result) == str(scratch)
    assert os.path.basename(result).startswith(".compressing-")
    assert result.endswith(".mp4")


def test_temp_sibling_path_names_stay_collision_free_across_calls(monkeypatch, tmp_path):
    # Different source files land on the *same* filename in the shared scratch
    # dir (name is keyed by pid+tid, not source path) — that's expected and
    # safe since one worker thread only ever has one file in flight at a time.
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    monkeypatch.setattr(common, "SCRATCH_DIR", str(scratch))

    a = common.temp_sibling_path(str(tmp_path / "a" / "one.mp4"), ".mp4", "compressing")
    b = common.temp_sibling_path(str(tmp_path / "b" / "two.mp4"), ".mp4", "compressing")

    assert a == b
