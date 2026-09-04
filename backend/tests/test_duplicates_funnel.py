from app.services.duplicates import scope_extraction_candidates

BASE_CRITERIA = {
    "use_size": False,
    "use_duration": False,
    "use_resolution": False,
    "use_content_date": False,
    "content_date_tolerance": 86400.0,
    "use_orientation": False,
    "use_bitrate": False,
    "bitrate_tolerance_pct": 10.0,
    "use_filename": False,
    "filename_threshold": 0.4,
    "duration_tolerance": 1.0,
}


def _file(id, **overrides):
    base = {
        "id": id,
        "size": 1000,
        "duration": 60.0,
        "file_width": 1920,
        "file_height": 1080,
        "file_date": 0.0,
        "video_bitrate": 5000,
        "filename": f"file{id}.mp4",
    }
    base.update(overrides)
    return base


def test_zero_criteria_includes_everything():
    files = [_file(1), _file(2), _file(3)]
    result = scope_extraction_candidates(files, BASE_CRITERIA)
    assert result == {1, 2, 3}


def test_zero_criteria_single_file_still_included():
    # No filter narrows anything, so even a lone file is "in the one group."
    files = [_file(1)]
    result = scope_extraction_candidates(files, BASE_CRITERIA)
    assert result == {1}


def test_size_excludes_unique_sizes():
    files = [_file(1, size=100), _file(2, size=100), _file(3, size=999)]
    criteria = {**BASE_CRITERIA, "use_size": True}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_duration_tolerance_excludes_far_apart_files():
    files = [_file(1, duration=60.0), _file(2, duration=60.5), _file(3, duration=200.0)]
    criteria = {**BASE_CRITERIA, "use_duration": True, "duration_tolerance": 1.0}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_size_and_duration_combined():
    files = [
        _file(1, size=100, duration=60.0),
        _file(2, size=100, duration=60.5),
        _file(3, size=100, duration=200.0),  # right size, wrong duration
        _file(4, size=999, duration=60.0),  # right duration, wrong size
    ]
    criteria = {**BASE_CRITERIA, "use_size": True, "use_duration": True, "duration_tolerance": 1.0}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_resolution_exact_match_only():
    files = [
        _file(1, file_width=1920, file_height=1080),
        _file(2, file_width=1920, file_height=1080),
        _file(3, file_width=1280, file_height=720),
    ]
    criteria = {**BASE_CRITERIA, "use_resolution": True}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_orientation_groups_by_category_not_exact_dims():
    files = [
        _file(1, file_width=1920, file_height=1080),  # landscape
        _file(2, file_width=1280, file_height=720),  # landscape, different res
        _file(3, file_width=1080, file_height=1920),  # portrait
    ]
    criteria = {**BASE_CRITERIA, "use_orientation": True}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_bitrate_tolerance_percent():
    files = [
        _file(1, video_bitrate=5000),
        _file(2, video_bitrate=5200),  # within 10%
        _file(3, video_bitrate=8000),  # outside 10%
    ]
    criteria = {**BASE_CRITERIA, "use_bitrate": True, "bitrate_tolerance_pct": 10.0}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_content_date_tolerance():
    files = [
        _file(1, file_date=1000.0),
        _file(2, file_date=1030.0),  # 30s apart
        _file(3, file_date=100000.0),
    ]
    criteria = {**BASE_CRITERIA, "use_content_date": True, "content_date_tolerance": 60.0}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_filename_similarity():
    files = [
        _file(1, filename="Movie.2020.1080p.mkv"),
        _file(2, filename="Movie.2020.720p.mkv"),
        _file(3, filename="Completely.Different.mkv"),
    ]
    criteria = {**BASE_CRITERIA, "use_filename": True, "filename_threshold": 0.5}
    result = scope_extraction_candidates(files, criteria)
    assert result == {1, 2}


def test_files_missing_required_field_are_excluded_from_that_stage():
    files = [_file(1, duration=None), _file(2, duration=60.0), _file(3, duration=60.2)]
    criteria = {**BASE_CRITERIA, "use_duration": True}
    result = scope_extraction_candidates(files, criteria)
    assert result == {2, 3}
