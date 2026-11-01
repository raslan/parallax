import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models.settings import get_setting, set_setting
from app.schemas import (
    PruneCrumb,
    PruneDeleteBody,
    PruneDeleteFolderBody,
    PruneDeleteResult,
    PruneDetailsBody,
    PruneDetailsResult,
    PruneFile,
    PruneFolder,
    PruneRoot,
    PruneRootBody,
    PruneScanState,
    PruneSubfolder,
)
from app.services import prune_files, prune_scan
from app.services.prune_sandbox import SandboxError, kind_of, resolve_inside, validate_root

router = APIRouter(prefix="/prune", tags=["prune"])

_ROOT_KEY = "prune_root"


def get_root(db: Session) -> str:
    """Saved root, or 409 when unset, no longer a directory, or no longer itself
    (the saved realpath became a symlink, or a parent was swapped)."""
    root = get_setting(db, _ROOT_KEY, "")
    if not root:
        raise HTTPException(409, "No folder selected")
    if not os.path.isdir(root) or os.path.realpath(root) != root:
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
def start_scan(force: bool = False, db: Session = Depends(get_db)):
    """Scan the root; without ``force`` a finished scan of the same root is reused."""
    prune_scan.start_scan(get_root(db), force=force)
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
    node = prune_scan.snapshot(real)
    if node is None:
        raise HTTPException(404, "Folder not found")
    crumbs = [PruneCrumb(name=os.path.basename(root) or root, path=root)]
    cur = root
    rel = os.path.relpath(real, root)
    if rel != ".":
        for part in rel.split(os.sep):
            cur = os.path.join(cur, part)
            crumbs.append(PruneCrumb(name=part, path=cur))
    subs = sorted(node["children"], key=lambda c: c["name"].casefold())
    return PruneFolder(
        path=node["path"],
        name=node["name"],
        parent=os.path.dirname(real) if real != root else None,
        breadcrumbs=crumbs,
        direct=node["direct"],
        total=node["total"],
        subfolders=[PruneSubfolder(**c) for c in subs],
    )


@router.get("/files", response_model=list[PruneFile])
async def read_files(path: str, db: Session = Depends(get_db)):
    root = get_root(db)
    db.close()  # no connection held across the directory read
    real = _sandboxed(root, path)
    if not os.path.isdir(real):
        raise HTTPException(400, "Not a folder")
    try:
        return await run_in_threadpool(prune_files.list_files, real)
    except OSError as e:
        raise HTTPException(409, "Folder could not be read") from e


_MAX_DETAILS = 50


@router.post("/details", response_model=PruneDetailsResult)
async def read_details(body: PruneDetailsBody, db: Session = Depends(get_db)):
    if len(body.paths) > _MAX_DETAILS:
        raise HTTPException(400, f"At most {_MAX_DETAILS} paths per request")
    root = get_root(db)
    db.close()
    paths = list(dict.fromkeys(body.paths))
    for p in paths:
        try:
            _sandboxed(root, p)  # 403/400 fail the batch; the service lstat()s the raw path
        except HTTPException as e:
            if e.status_code != 404:
                raise  # a file that vanished just comes back null
    return PruneDetailsResult(details=await run_in_threadpool(prune_files.get_details, paths))


def _servable(db: Session, path: str) -> str:
    """Root check + sandbox + regular-file check; frees the DB session. Returns the real path."""
    root = get_root(db)
    db.close()
    real = _sandboxed(root, path)
    if not prune_files.servable_file(path):
        raise HTTPException(404, "File not found")
    return real


@router.get("/thumbnail")
async def read_thumbnail(path: str, db: Session = Depends(get_db)):
    real = _servable(db, path)
    thumb = await run_in_threadpool(prune_files.thumbnail_for, real)  # one cache key per file
    if thumb is None or not os.path.exists(real):
        raise HTTPException(404, "No thumbnail")
    return FileResponse(thumb, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@router.get("/file")
def read_file(path: str, db: Session = Depends(get_db)):
    real = _servable(db, path)
    if kind_of(real) == "other":  # media only: never serve e.g. HTML same-origin
        raise HTTPException(415, "Not a media file")
    # FileResponse handles Range (206) for video/audio seeking.
    return FileResponse(
        real, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    )


@router.get("/audio")
def read_audio(path: str, db: Session = Depends(get_db)):
    real = _servable(db, path)
    ext = os.path.splitext(real)[1].lower()
    if kind_of(real) != "audio" or ext in prune_files.NATIVE_AUDIO_EXTENSIONS:
        raise HTTPException(400, "Not a non-native audio file")
    return StreamingResponse(
        prune_files.stream_audio_mp3(real),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/delete", response_model=PruneDeleteResult)
async def delete_files(body: PruneDeleteBody, db: Session = Depends(get_db)):
    root = get_root(db)
    db.close()
    return await run_in_threadpool(prune_files.delete_files, root, body.paths)


@router.post("/delete-folder", status_code=204)
async def delete_folder(body: PruneDeleteFolderBody, db: Session = Depends(get_db)):
    root = get_root(db)
    db.close()
    try:
        await run_in_threadpool(prune_files.delete_folder, root, body.path, body.only_if_empty)
    except SandboxError as e:
        raise HTTPException(e.status, str(e)) from e
