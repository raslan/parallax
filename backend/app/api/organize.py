import contextlib
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.settings import get_setting, set_setting
from app.schemas import (
    OrganizeDeleteBody,
    OrganizeDeleteFolderBody,
    OrganizeDeleteResult,
    OrganizeDetailsBody,
    OrganizeDetailsResult,
    OrganizeFile,
    OrganizeFolder,
    OrganizeMoveBody,
    OrganizeMoveResult,
    OrganizeMoveToFolderBody,
    OrganizeRenameBody,
    OrganizeRenameFolderBody,
    OrganizeRenameFolderResult,
    OrganizeRenameResult,
    OrganizeRoot,
    OrganizeRootBody,
    OrganizeScanState,
    OrganizeStreamBody,
)
from app.services import organize_files, organize_scan, stream_cache
from app.services.organize_sandbox import (
    DeleteFailed,
    FolderNotEmpty,
    InvalidPath,
    OutsideRoot,
    PathNotFound,
    SandboxError,
    kind_of,
    resolve_inside,
    validate_root,
)

router = APIRouter(prefix="/organize", tags=["organize"])

_ROOT_KEY = "organize_root"


def get_root(db: Session) -> str:
    """Saved root, or 409 when unset, no longer a directory, or no longer itself
    (the saved realpath became a symlink, or a parent was swapped).

    Closes ``db`` right after reading the setting, before any filesystem check, so
    no pooled connection is held across slow I/O (a stale mount can hang isdir).
    Every caller is done with the session once it has the root."""
    root = get_setting(db, _ROOT_KEY, "")
    db.close()
    if not root:
        raise HTTPException(409, "No folder selected")
    if not os.path.isdir(root) or os.path.realpath(root) != root:
        raise HTTPException(409, "Folder is no longer available")
    return root


# The one place a sandbox refusal becomes an HTTP status (CODE_CONVENTIONS B3):
# registered app-wide in main.py, so no route maps SandboxError by hand.
_SANDBOX_STATUS: dict[type[SandboxError], int] = {
    InvalidPath: 400,
    OutsideRoot: 403,
    PathNotFound: 404,
    FolderNotEmpty: 409,
    DeleteFailed: 500,
}


def sandbox_error_handler(request: Request | None, exc: SandboxError) -> JSONResponse:
    """``SandboxError`` -> its status + ``{"detail": message}`` (HTTPException's shape)."""
    status = next((s for cls, s in _SANDBOX_STATUS.items() if isinstance(exc, cls)), 500)
    return JSONResponse({"detail": str(exc)}, status_code=status)


@router.get("/root", response_model=OrganizeRoot)
def read_root(db: Session = Depends(get_db)):
    return OrganizeRoot(root=get_setting(db, _ROOT_KEY, "") or None)


@router.put("/root", response_model=OrganizeRoot)
def write_root(body: OrganizeRootBody, db: Session = Depends(get_db)):
    root = validate_root(body.path)
    set_setting(db, _ROOT_KEY, root)
    organize_scan.invalidate()
    return OrganizeRoot(root=root)


@router.post("/scan", response_model=OrganizeScanState)
def start_scan(force: bool = False, db: Session = Depends(get_db)):
    """Scan the root; without ``force`` a finished scan of the same root is reused."""
    organize_scan.start_scan(get_root(db), force=force)
    return organize_scan.scan_state()


@router.get("/scan", response_model=OrganizeScanState)
def read_scan(db: Session = Depends(get_db)):
    get_root(db)
    return organize_scan.scan_state()


@router.get("/folder", response_model=OrganizeFolder)
def read_folder(path: str, db: Session = Depends(get_db)):
    root = get_root(db)
    real = resolve_inside(root, path)
    if organize_scan.scan_state()["status"] == "running":
        raise HTTPException(409, "scanning")
    view = organize_scan.folder_view(root, real)
    if view is None:
        raise HTTPException(404, "Folder not found")
    return OrganizeFolder(**view)


# Every route here is a plain ``def``: FastAPI runs it in the threadpool, so the
# settings query, isdir/realpath/lstat and the service calls (any of which can hang
# on a stale network mount) never block the event loop. ``get_root`` closes the
# session before any filesystem work so no pooled connection is held across slow I/O
# (``write_root`` runs validate_root before its first query, so it holds none either).


@router.get("/files", response_model=list[OrganizeFile])
def read_files(path: str, db: Session = Depends(get_db)):
    root = get_root(db)
    real = resolve_inside(root, path)
    if not os.path.isdir(real):
        raise HTTPException(400, "Not a folder")
    try:
        return organize_files.list_files(real)
    except OSError as e:
        raise HTTPException(409, "Folder could not be read") from e


_MAX_DETAILS = 50


@router.post("/details", response_model=OrganizeDetailsResult)
def read_details(body: OrganizeDetailsBody, db: Session = Depends(get_db)):
    if len(body.paths) > _MAX_DETAILS:
        raise HTTPException(400, f"At most {_MAX_DETAILS} paths per request")
    root = get_root(db)
    paths = list(dict.fromkeys(body.paths))
    for p in paths:
        # 403/400 fail the batch; the service lstat()s the raw path
        with contextlib.suppress(PathNotFound):  # a file that vanished just comes back null
            resolve_inside(root, p)
    return OrganizeDetailsResult(details=organize_files.get_details(paths))


def _servable(db: Session, path: str) -> str:
    """Root check (frees the DB session) + sandbox + regular-file check. Returns the real path."""
    root = get_root(db)
    real = resolve_inside(root, path)
    if not organize_files.servable_file(path):
        raise HTTPException(404, "File not found")
    return real


@router.get("/thumbnail")
def read_thumbnail(path: str, db: Session = Depends(get_db)):
    real = _servable(db, path)  # session closed: none held during generation
    thumb = organize_files.thumbnail_for(real)  # one cache key per file
    if thumb is None or not os.path.exists(real):
        raise HTTPException(404, "No thumbnail")
    # Read it now rather than FileResponse(thumb): eviction may delete the cache
    # entry before the response is sent, which would be a 500 instead of a 404.
    try:
        with open(thumb, "rb") as fh:
            data = fh.read()
    except OSError as e:
        raise HTTPException(404, "No thumbnail") from e
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


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
    if kind_of(real) != "audio" or ext in organize_files.NATIVE_AUDIO_EXTENSIONS:
        raise HTTPException(400, "Not a non-native audio file")
    return StreamingResponse(
        organize_files.stream_audio_mp3(real),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


def _streamable(db: Session, path: str) -> str:
    real = _servable(db, path)
    if kind_of(real) != "video":
        raise HTTPException(415, "Not a video file")
    return real


@router.post("/stream/prepare")
def organize_stream_prepare(body: OrganizeStreamBody, db: Session = Depends(get_db)):
    """Sandboxed twin of ``POST /stream/prepare`` (same response). The HLS playlist and
    segments it points at (``/stream/hls/{sid}/…``) are keyed by the opaque session id
    of a file that already passed this sandbox, so they need no Organize twin."""
    return stream_cache.start_prepare(_streamable(db, body.path))


@router.get("/stream/prepare-status")
def organize_stream_status(path: str, db: Session = Depends(get_db)):
    """Sandboxed twin of ``GET /stream/prepare-status`` (same response)."""
    return stream_cache.needs_prepare(_streamable(db, path))


@router.post("/delete", response_model=OrganizeDeleteResult)
def delete_files(body: OrganizeDeleteBody, db: Session = Depends(get_db)):
    root = get_root(db)
    return organize_files.delete_files(root, body.paths)


@router.post("/move-to-subfolder", response_model=OrganizeMoveResult)
def move_to_subfolder(body: OrganizeMoveBody, db: Session = Depends(get_db)):
    root = get_root(db)
    return organize_files.move_to_subfolder(root, body.folder, body.paths, body.name)


@router.post("/move-to-folder", response_model=OrganizeMoveResult)
def move_to_folder(body: OrganizeMoveToFolderBody, db: Session = Depends(get_db)):
    root = get_root(db)
    return organize_files.move_to_folder(root, body.folder, body.paths, body.destination)


@router.post("/rename", response_model=OrganizeRenameResult)
def rename_files(body: OrganizeRenameBody, db: Session = Depends(get_db)):
    root = get_root(db)
    items = [(i.path, i.name) for i in body.items]
    return organize_files.rename_files(root, body.folder, items)


@router.post("/rename-folder", response_model=OrganizeRenameFolderResult)
def rename_folder(body: OrganizeRenameFolderBody, db: Session = Depends(get_db)):
    root = get_root(db)
    return {"path": organize_files.rename_folder(root, body.path, body.name)}


@router.post("/delete-folder", status_code=204)
def delete_folder(body: OrganizeDeleteFolderBody, db: Session = Depends(get_db)):
    organize_files.delete_folder(get_root(db), body.path, body.only_if_empty)
