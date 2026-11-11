"""copy_props: a replacement file takes over everything of the old one that can be set.

Best effort by design: whatever the filesystem refuses (ownership, extended attributes on
SMB/NFS/FAT) is skipped, and nothing here may ever raise.
"""

import os
import stat

import pytest

from app.services import file_props

OLD_NS = 1_500_000_000_123_456_789


def _pair(tmp_path, mode=0o640):
    old = tmp_path / "old.bin"
    new = tmp_path / "new.bin"
    old.write_bytes(b"old")
    new.write_bytes(b"new content")
    os.chmod(old, mode)
    os.chmod(new, 0o600)
    os.utime(old, ns=(OLD_NS, OLD_NS))
    return str(old), str(new)


def test_copies_modified_time_and_permissions(tmp_path):
    old, new = _pair(tmp_path)
    file_props.copy_props(old, new)
    st = os.stat(new)
    assert st.st_mtime_ns == OLD_NS
    assert st.st_atime_ns == OLD_NS
    assert stat.S_IMODE(st.st_mode) == 0o640


def test_leaves_the_content_alone(tmp_path):
    old, new = _pair(tmp_path)
    file_props.copy_props(old, new)
    assert open(new, "rb").read() == b"new content"


def test_copies_extended_attributes(tmp_path):
    old, new = _pair(tmp_path)
    try:
        os.setxattr(old, "user.parallax-test", b"kept")
    except OSError:
        pytest.skip("filesystem has no user extended attributes")
    file_props.copy_props(old, new)
    assert os.getxattr(new, "user.parallax-test") == b"kept"


def test_one_refused_step_does_not_stop_the_others(tmp_path, monkeypatch):
    old, new = _pair(tmp_path)

    def refuse(*_a, **_k):
        raise PermissionError("not allowed")

    monkeypatch.setattr(os, "chown", refuse)
    monkeypatch.setattr(os, "chmod", refuse)
    monkeypatch.setattr(os, "setxattr", refuse, raising=False)
    file_props.copy_props(old, new)  # must not raise
    assert os.stat(new).st_mtime_ns == OLD_NS


def test_missing_source_or_target_is_ignored(tmp_path):
    old, new = _pair(tmp_path)
    file_props.copy_props(str(tmp_path / "gone"), new)
    file_props.copy_props(old, str(tmp_path / "also-gone"))
    assert os.stat(new).st_mtime_ns != OLD_NS  # nothing was copied from a missing source
