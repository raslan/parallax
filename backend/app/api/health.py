import os
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text
from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@router.get("/fs/browse")
def fs_browse(path: str = Query("/media")):
    # Resolve and validate — prevent path traversal
    try:
        resolved = os.path.realpath(path)
    except Exception:
        raise HTTPException(400, "Invalid path")
    if not os.path.isdir(resolved):
        raise HTTPException(404, "Not a directory")
    try:
        entries = os.scandir(resolved)
        dirs = sorted(e.name for e in entries if e.is_dir(follow_symlinks=True) and not e.name.startswith("."))
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    parent = str(os.path.dirname(resolved)) if resolved != "/" else None
    return {"path": resolved, "parent": parent, "dirs": dirs}
