from app.services.byte_hash import compute_byte_hash


def test_identical_files_same_hash(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"x" * (2 * 1024 * 1024))
    b.write_bytes(b"x" * (2 * 1024 * 1024))
    assert compute_byte_hash(str(a)) == compute_byte_hash(str(b))


def test_different_content_different_hash(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"x" * 2048)
    b.write_bytes(b"y" * 2048)
    assert compute_byte_hash(str(a)) != compute_byte_hash(str(b))


def test_missing_file_returns_none():
    assert compute_byte_hash("/nonexistent/path.mp4") is None


def test_small_file_hashes_whole_content(tmp_path):
    a = tmp_path / "a.bin"
    a.write_bytes(b"short")
    assert compute_byte_hash(str(a)) is not None
