"""File listing and safe deletion for the Prune page.

Plain sync functions (routers call them via ``run_in_threadpool``). Because
``resolve_inside`` follows the final symlink, every delete also inspects the
*unresolved* path and refuses symlinks outright.
"""

import os
import shutil
import stat

from app.services import prune_scan
from app.services.prune_sandbox import SandboxError, is_hidden, kind_of, resolve_inside
from app.services.prune_scan import Counts


def list_files(folder: str) -> list[dict]:
    """Direct, non-hidden, regular, non-symlink files of ``folder`` (live scandir)."""
    out: list[dict] = []
    with os.scandir(folder) as it:
        for entry in it:
            if is_hidden(entry.name):
                continue
            try:
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                    continue
                st = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            out.append(
                {
                    "name": entry.name,
                    "path": os.path.join(folder, entry.name),
                    "kind": kind_of(entry.name),
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                }
            )
    out.sort(key=lambda f: f["name"].casefold())
    return out


def _strip_trailing_seps(path: str) -> str:
    """``ln/`` follows a symlink in lstat/islink; drop trailing separators first."""
    return path.rstrip(os.sep) or path


def _delete_one(root: str, path: str) -> tuple[str, Counts]:
    """Delete one regular file; returns (parent folder, counts). Raises ValueError on refusal.

    Note: a parent directory swapped for a symlink between the checks and the
    remove is a tiny TOCTOU window we accept (single-owner tool).
    """
    path = _strip_trailing_seps(path)
    try:
        real = resolve_inside(root, path)
    except SandboxError as e:
        raise ValueError(str(e)) from e
    if is_hidden(os.path.basename(path)):
        raise ValueError("Hidden files are not managed here")
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise ValueError("File no longer exists") from None
    if stat.S_ISLNK(st.st_mode):
        raise ValueError("Symbolic links are not deleted")
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Not a regular file")
    if real == os.path.realpath(root):
        raise ValueError("Not a regular file")
    os.remove(real)
    return os.path.dirname(real), prune_scan.file_counts(os.path.basename(real), st.st_size)


def delete_files(root: str, paths: list[str]) -> dict:
    deleted: list[str] = []
    failed: list[dict] = []
    per_folder: dict[str, Counts] = {}
    for path in dict.fromkeys(paths):
        try:
            folder, counts = _delete_one(root, path)
        except ValueError as e:
            failed.append({"path": path, "error": str(e) or "Invalid path"})
            continue
        except OSError as e:
            failed.append({"path": path, "error": e.strerror or "Could not delete"})
            continue
        deleted.append(path)
        per_folder.setdefault(folder, Counts()).add(counts)
    empty: list[str] = []
    for folder, counts in per_folder.items():
        prune_scan.apply_deleted_files(folder, counts)
        if folder == os.path.realpath(root):
            continue  # the root is never offered for deletion
        try:
            if not os.listdir(folder):
                empty.append(folder)
        except OSError:
            pass
    return {"deleted": deleted, "failed": failed, "empty_folders": empty}


def delete_folder(root: str, path: str) -> None:
    """Recursively delete a folder inside ``root`` (never the root, never a symlink)."""
    path = _strip_trailing_seps(path)
    try:
        if os.path.islink(path):
            raise SandboxError(400, "Symbolic links are not deleted")
        real = resolve_inside(root, path)
    except ValueError as e:  # NUL byte
        raise SandboxError(400, "Invalid path") from e
    if real == os.path.realpath(root):
        raise SandboxError(400, "The root folder cannot be deleted")
    if not os.path.isdir(real):
        raise SandboxError(400, "Not a folder")
    try:
        shutil.rmtree(real)
    except OSError as e:
        prune_scan.invalidate()  # partial delete: the cache can no longer be trusted
        raise SandboxError(500, f"Could not delete folder: {e.strerror or e}") from e
    prune_scan.remove_folder(real)
