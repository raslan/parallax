"""Cached counts tree for the Prune page.

One background scan of the saved root builds a tree of per-folder counts
(never file lists). The finished tree is swapped in atomically, so readers
never see a half-built tree. Hidden entries and symlinks are skipped.

Races: ``invalidate()`` bumps a generation; a scan from an older generation stops
at its next folder and never touches the progress or the cached tree. A delete
while a scan runs marks it dirty, and a dirty scan walks again on completion
(status stays ``running``), so the result never counts deleted entries.
"""

import os
import threading
from dataclasses import asdict, dataclass, field, fields

from app.services.prune_sandbox import is_hidden, kind_of

_KIND_FIELD = {"image": "images", "video": "videos", "audio": "audio", "other": "other"}


@dataclass
class Counts:
    files: int = 0
    images: int = 0
    videos: int = 0
    audio: int = 0
    other: int = 0
    bytes: int = 0

    def add(self, other: "Counts", sign: int = 1) -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + sign * getattr(other, f.name))


@dataclass
class FolderNode:
    path: str
    name: str
    direct: Counts = field(default_factory=Counts)
    total: Counts = field(default_factory=Counts)
    children: dict[str, "FolderNode"] = field(default_factory=dict)


_lock = threading.Lock()
_tree: FolderNode | None = None
_state: dict = {"status": "idle", "folders_scanned": 0, "root": None}
# Bumped by invalidate(): a scan carries the generation it started under and only
# reports progress / swaps in its tree while that is still current; a superseded
# walk stops at the next folder.
_generation = 0
# Set by a delete while a scan runs: the walk may have counted the deleted entries,
# so the finished tree is not trusted and the scan walks again (bounded).
_dirty = False
_MAX_PASSES = 3


class _Stale(Exception):
    """The scan's generation was superseded mid-walk."""


def scan_state() -> dict:
    with _lock:
        return dict(_state)


def get_node(path: str) -> FolderNode | None:
    with _lock:
        chain = _ancestors(path)
        return chain[-1] if chain else None


def invalidate() -> None:
    global _tree, _generation, _dirty
    with _lock:
        _generation += 1
        _dirty = False
        _tree = None
        _state.update(status="idle", folders_scanned=0, root=None)


def start_scan(root: str, force: bool = False) -> None:
    """Start a background scan unless one is running, or (without ``force``) a
    finished tree for this same root is already cached."""
    with _lock:
        if _state["status"] == "running":
            return
        cached = _state["status"] == "done" and _state["root"] == root and _tree is not None
        if cached and not force:
            return
        gen = _generation
        _state.update(status="running", folders_scanned=0, root=root)
    threading.Thread(target=_run, args=(root, gen), daemon=True).start()


def _run(root: str, gen: int) -> None:
    """Walk until a pass finishes with no delete landing during it (at most
    ``_MAX_PASSES``; the last pass is then trusted). Status stays ``running``
    across passes."""
    global _tree, _dirty
    for attempt in range(1, _MAX_PASSES + 1):
        with _lock:
            if gen != _generation:
                return
            _dirty = False
            _state["folders_scanned"] = 0
        try:
            tree = _build(root, gen)
        except _Stale:
            return
        except Exception:
            with _lock:
                if gen == _generation:
                    _state["status"] = "error"
            return
        with _lock:
            if gen != _generation:
                return
            if _dirty and attempt < _MAX_PASSES:
                continue
            _dirty = False
            _tree = tree
            _state["status"] = "done"
            return


def _build(path: str, gen: int) -> FolderNode:
    if gen != _generation:
        raise _Stale
    node = FolderNode(path=path, name=os.path.basename(path) or path)
    subdirs: list[str] = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                if is_hidden(entry.name):
                    continue
                try:
                    if entry.is_symlink():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        subdirs.append(entry.name)
                    elif entry.is_file(follow_symlinks=False):
                        size = entry.stat(follow_symlinks=False).st_size
                        node.direct.files += 1
                        node.direct.bytes += size
                        attr = _KIND_FIELD[kind_of(entry.name)]
                        setattr(node.direct, attr, getattr(node.direct, attr) + 1)
                except OSError:
                    continue
    except OSError:
        pass  # unreadable directory: counted as empty, scan carries on
    node.total.add(node.direct)
    for name in subdirs:
        child = _build(os.path.join(path, name), gen)
        node.children[name] = child
        node.total.add(child.total)
    with _lock:
        if gen != _generation:
            raise _Stale
        _state["folders_scanned"] += 1
    return node


def _mark_dirty_locked() -> None:
    global _dirty
    if _state["status"] == "running":
        _dirty = True


def _ancestors(path: str) -> list[FolderNode] | None:
    """Nodes from the root down to ``path`` inclusive (caller holds the lock)."""
    node = _tree
    if node is None:
        return None
    rel = os.path.relpath(path, node.path)
    chain = [node]
    if rel == ".":
        return chain
    if rel.startswith(".."):
        return None
    for part in rel.split(os.sep):
        node = node.children.get(part)
        if node is None:
            return None
        chain.append(node)
    return chain


def file_counts(name: str, size: int) -> Counts:
    """Counts for a single file, as the scan would have recorded it."""
    c = Counts(files=1, bytes=size)
    setattr(c, _KIND_FIELD[kind_of(name)], 1)
    return c


def _subtract(target: Counts, counts: Counts) -> None:
    """Subtract, clamping at zero (the cache can lag the disk)."""
    for f in fields(target):
        setattr(target, f.name, max(0, getattr(target, f.name) - getattr(counts, f.name)))


def snapshot(path: str) -> dict | None:
    """Detached copy of a node's own data and its children, taken under the lock."""
    with _lock:
        chain = _ancestors(path)
        if not chain:
            return None
        node = chain[-1]
        return {
            "path": node.path,
            "name": node.name,
            "direct": asdict(node.direct),
            "total": asdict(node.total),
            "children": [
                {
                    "path": c.path,
                    "name": c.name,
                    "direct": asdict(c.direct),
                    "total": asdict(c.total),
                }
                for c in node.children.values()
            ],
        }


def folder_view(root: str, real: str) -> dict | None:
    """``snapshot(real)`` shaped for the folder page: breadcrumbs from ``root`` down,
    ``parent`` (None at the root) and subfolders sorted case-insensitively.
    ``real`` must already be sandboxed inside ``root``. None when not cached."""
    node = snapshot(real)
    if node is None:
        return None
    crumbs = [{"name": os.path.basename(root) or root, "path": root}]
    cur = root
    rel = os.path.relpath(real, root)
    if rel != ".":
        for part in rel.split(os.sep):
            cur = os.path.join(cur, part)
            crumbs.append({"name": part, "path": cur})
    return {
        "path": node["path"],
        "name": node["name"],
        "parent": os.path.dirname(real) if real != root else None,
        "breadcrumbs": crumbs,
        "direct": node["direct"],
        "total": node["total"],
        "subfolders": sorted(node["children"], key=lambda c: c["name"].casefold()),
    }


def apply_deleted_files(folder: str, counts: Counts) -> None:
    """Subtract deleted files from ``folder``'s direct and every total up the chain."""
    with _lock:
        _mark_dirty_locked()
        chain = _ancestors(folder)
        if not chain:
            return
        _subtract(chain[-1].direct, counts)
        for n in chain:
            _subtract(n.total, counts)


def remove_folder(path: str) -> None:
    """Drop a folder (and its subtree) from the tree and from ancestors' totals."""
    with _lock:
        _mark_dirty_locked()
        chain = _ancestors(path)
        if not chain or len(chain) < 2:
            return
        node = chain[-1]
        for n in chain[:-1]:
            _subtract(n.total, node.total)
        del chain[-2].children[node.name]
