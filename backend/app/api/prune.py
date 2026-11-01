import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting
from app.schemas import PruneRoot, PruneRootBody
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
    # Scan-cache invalidation is wired in Task 3 (prune_scan.invalidate()).
    return PruneRoot(root=root)
