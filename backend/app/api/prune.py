import os
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting
from app.schemas import (
    PruneCrumb,
    PruneFolder,
    PruneRoot,
    PruneRootBody,
    PruneScanState,
    PruneSubfolder,
)
from app.services import prune_scan
from app.services.prune_sandbox import SandboxError, resolve_inside, validate_root

router = APIRouter(prefix="/prune", tags=["prune"])

_ROOT_KEY = "prune_root"


def get_root(db: Session) -> str:
    """Saved root, or 409 when unset or no longer a directory."""
    root = get_setting(db, _ROOT_KEY, "")
    if not root:
        raise HTTPException(409, "No folder selected")
    if not os.path.isdir(root):
        raise HTTPException(409, "Folder is no longer available")
    return root


def _sandboxed(root: str, path: str) -> str:
    try:
        return resolve_inside(root, path)
    except SandboxError as e:
        raise HTTPException(e.status, str(e)) from e
    except ValueError as e:  # e.g. NUL byte in the path
        raise HTTPException(400, "Invalid path") from e


@router.get("/root", response_model=PruneRoot)
def read_root(db: Session = Depends(get_db)):
    return PruneRoot(root=get_setting(db, _ROOT_KEY, "") or None)


@router.put("/root", response_model=PruneRoot)
def write_root(body: PruneRootBody, db: Session = Depends(get_db)):
    try:
        root = validate_root(body.path)
    except SandboxError as e:
        raise HTTPException(e.status, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, "Invalid path") from e
    set_setting(db, _ROOT_KEY, root)
    prune_scan.invalidate()
    return PruneRoot(root=root)


@router.post("/scan", response_model=PruneScanState)
def start_scan(db: Session = Depends(get_db)):
    prune_scan.start_scan(get_root(db))
    return prune_scan.scan_state()


@router.get("/scan", response_model=PruneScanState)
def read_scan(db: Session = Depends(get_db)):
    get_root(db)
    return prune_scan.scan_state()


@router.get("/folder", response_model=PruneFolder)
def read_folder(path: str, db: Session = Depends(get_db)):
    root = get_root(db)
    real = _sandboxed(root, path)
    if prune_scan.scan_state()["status"] == "running":
        raise HTTPException(409, "scanning")
    node = prune_scan.get_node(real)
    if node is None:
        raise HTTPException(404, "Folder not found")
    crumbs = [PruneCrumb(name=os.path.basename(root) or root, path=root)]
    cur = root
    rel = os.path.relpath(real, root)
    if rel != ".":
        for part in rel.split(os.sep):
            cur = os.path.join(cur, part)
            crumbs.append(PruneCrumb(name=part, path=cur))
    subs = sorted(node.children.values(), key=lambda c: c.name.casefold())
    return PruneFolder(
        path=node.path,
        name=node.name,
        parent=os.path.dirname(real) if real != root else None,
        breadcrumbs=crumbs,
        direct=asdict(node.direct),
        total=asdict(node.total),
        subfolders=[
            PruneSubfolder(name=c.name, path=c.path, direct=asdict(c.direct), total=asdict(c.total))
            for c in subs
        ],
    )
