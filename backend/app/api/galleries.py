import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import (
    ClearGalleriesRequest,
    GalleryEnqueueRequest,
    GalleryListTypes,
    GalleryOptions,
    UrlFileBody,
    UrlListRename,
)
from app.services.gallery_archive import archive_info, reset_archive
from app.services.gallery_dl import (
    archive_path,
    cancel_gallery,
    get_gallerydl_info,
    install_gallerydl,
    list_ytdl_impersonate_targets,
    run_gallery,
    set_gallery_max_parallel,
)
from app.services.gallery_options import (
    clear_list_types,
    effective_options,
    load_list_types,
    load_options,
    rename_list_types,
    save_options,
    set_list_types,
)
from app.services.gallery_urllists import (
    delete_list,
    list_exists,
    list_lists,
    read_list,
    read_urls,
    rename_list,
    validate_name,
    write_list,
)

router = APIRouter(prefix="/galleries", tags=["galleries"])

_ACTIVE = {GalleryDownloadStatus.PENDING, GalleryDownloadStatus.RUNNING}
_TERMINAL = {
    GalleryDownloadStatus.COMPLETED,
    GalleryDownloadStatus.FAILED,
    GalleryDownloadStatus.CANCELLED,
}


def serialize(g: GalleryDownload) -> dict:
    return {
        "id": g.id,
        "url": g.url,
        "status": g.status,
        "files_done": g.files_done,
        "files_skipped": g.files_skipped,
        "files_failed": g.files_failed,
        "last_filename": g.last_filename,
        "recent_files": json.loads(g.recent_files) if g.recent_files else [],
        "error": g.error,
        "log_tail": g.log_tail,
        "output_dir": g.output_dir,
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "started_at": g.started_at.isoformat() if g.started_at else None,
        "finished_at": g.finished_at.isoformat() if g.finished_at else None,
    }


@router.get("")
def list_galleries(db: Session = Depends(get_db)):
    rows = db.query(GalleryDownload).order_by(GalleryDownload.created_at.desc()).limit(200).all()
    return [serialize(r) for r in rows]


@router.post("")
async def enqueue(req: GalleryEnqueueRequest, db: Session = Depends(get_db)):
    opts = load_options(db)
    if not opts.baseDir.strip():
        raise HTTPException(400, "Pick a base directory in options first")

    # File mode expands the selected URL list into one row per line, snapshotted as paste mode,
    # so every URL gets its own ladder / progress / retry and shares the maxParallel semaphore.
    if opts.inputMode == "file":
        try:
            urls = read_urls(opts.urlList)
        except FileNotFoundError:
            raise HTTPException(400, f"URL list '{opts.urlList}' not found") from None
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        opts = effective_options(db, opts, opts.urlList).model_copy(update={"inputMode": "paste"})
    else:
        urls = [u.strip() for u in req.urls if u.strip()]
    snapshot = opts.model_dump_json()
    created: list[int] = []

    for url in urls:
        row = GalleryDownload(
            url=url,
            status=GalleryDownloadStatus.PENDING,
            output_dir=opts.baseDir,
            options=snapshot,
        )
        db.add(row)
        db.flush()
        created.append(row.id)

    if not created:
        raise HTTPException(400, "No URLs given")

    db.commit()
    for rid in created:
        asyncio.create_task(run_gallery(rid, req.cookies, opts.maxParallel))
    return {"ids": created}


@router.post("/retry-failed")
async def retry_failed(db: Session = Depends(get_db)):
    opts = load_options(db)
    old = (
        db.query(GalleryDownload)
        .filter(
            GalleryDownload.status.in_(
                [GalleryDownloadStatus.FAILED, GalleryDownloadStatus.CANCELLED]
            )
        )
        .all()
    )
    created: list[int] = []
    for o in old:
        new = GalleryDownload(
            url=o.url,
            status=GalleryDownloadStatus.PENDING,
            output_dir=o.output_dir,
            options=o.options,
        )
        db.add(new)
        db.flush()
        created.append(new.id)
        db.delete(o)
    db.commit()
    for rid in created:
        asyncio.create_task(run_gallery(rid, "", opts.maxParallel))
    return {"ids": created}


@router.post("/stop-all")
def stop_all(db: Session = Depends(get_db)):
    rows = db.query(GalleryDownload).filter(GalleryDownload.status.in_(list(_ACTIVE))).all()
    for r in rows:
        cancel_gallery(r.id)
        db.delete(r)
    db.commit()
    return {"stopped": len(rows)}


@router.post("/clear")
def clear(req: ClearGalleriesRequest, db: Session = Depends(get_db)):
    statuses = [s for s in req.statuses if s in _TERMINAL]
    rows = db.query(GalleryDownload).filter(GalleryDownload.status.in_(statuses)).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return {"cleared": len(rows)}


@router.delete("/{gallery_id}", status_code=204)
def delete_one(gallery_id: int, db: Session = Depends(get_db)):
    row = db.get(GalleryDownload, gallery_id)
    if not row:
        raise HTTPException(404, "Not found")
    if row.status in _ACTIVE:
        cancel_gallery(gallery_id)
    db.delete(row)
    db.commit()


@router.get("/stream")
async def stream():
    async def gen():
        last = None
        idle = 0
        while True:
            db = SessionLocal()
            try:
                rows = (
                    db.query(GalleryDownload)
                    .order_by(GalleryDownload.created_at.desc())
                    .limit(200)
                    .all()
                )
                any_active = any(r.status in _ACTIVE for r in rows)
                payload = json.dumps([serialize(r) for r in rows])
            finally:
                db.close()
            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload
                idle = 0
            else:
                idle += 1
            await asyncio.sleep(0.5 if any_active else min(2.0 + idle * 0.5, 5.0))

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/options")
def get_options(db: Session = Depends(get_db)):
    return load_options(db).model_dump()


@router.put("/options")
def put_options(opts: GalleryOptions, db: Session = Depends(get_db)):
    save_options(db, opts)
    set_gallery_max_parallel(opts.maxParallel)
    return {"ok": True}


@router.get("/archive")
def get_archive(db: Session = Depends(get_db)):
    return archive_info(archive_path(load_options(db)))


@router.post("/archive/reset")
def reset_gallery_archive(db: Session = Depends(get_db)):
    """Delete the download archive so already-fetched items become eligible again.

    409 while a gallery is pending/running — gallery-dl has the file open and would write
    back into (or recreate) it mid-reset.
    """
    if db.query(GalleryDownload).filter(GalleryDownload.status.in_(_ACTIVE)).first():
        raise HTTPException(409, "Stop or wait for active galleries before resetting the archive")
    path = archive_path(load_options(db))
    try:
        reset_archive(path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except OSError as e:
        raise HTTPException(500, f"Couldn't delete the archive: {e}") from None
    return archive_info(path)


@router.get("/urllists")
def get_urllists():
    return {"lists": list_lists()}


@router.get("/urllists/{name}")
def get_urllist(name: str):
    try:
        return {"name": name, "text": read_list(name)}
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except FileNotFoundError:
        raise HTTPException(404, f"URL list '{name}' not found") from None


@router.put("/urllists/{name}")
def put_urllist(name: str, body: UrlFileBody):
    """Create or overwrite a list."""
    try:
        write_list(name, body.text)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.delete("/urllists/{name}", status_code=204)
def delete_urllist(name: str, db: Session = Depends(get_db)):
    try:
        delete_list(name)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except FileNotFoundError:
        raise HTTPException(404, f"URL list '{name}' not found") from None
    # a list recreated under this name must not inherit the old content-type override
    clear_list_types(db, validate_name(name))


@router.post("/urllists/{name}/rename")
def rename_urllist(name: str, body: UrlListRename, db: Session = Depends(get_db)):
    try:
        new = rename_list(name, body.name)
        rename_list_types(db, validate_name(name), new)
        return {"name": new}
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except FileNotFoundError:
        raise HTTPException(404, f"URL list '{name}' not found") from None
    except FileExistsError:
        raise HTTPException(409, f"A list named '{body.name.strip()}' already exists") from None


def _types_view(db: Session, name: str) -> dict:
    override = load_list_types(db).get(name)
    opts = load_options(db)
    effective = override or GalleryListTypes(
        typeVideo=opts.typeVideo,
        typeAudio=opts.typeAudio,
        typeImage=opts.typeImage,
        typeAny=opts.typeAny,
    )
    return {
        "override": override.model_dump() if override else None,
        "effective": effective.model_dump(),
    }


def _checked_list_name(name: str) -> str:
    """The validated list name; 400 for a bad one, 404 when no such list exists."""
    try:
        clean = validate_name(name)
        exists = list_exists(clean)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if not exists:
        raise HTTPException(404, f"URL list '{name}' not found")
    return clean


@router.get("/urllists/{name}/types")
def get_urllist_types(name: str, db: Session = Depends(get_db)):
    return _types_view(db, _checked_list_name(name))


@router.put("/urllists/{name}/types")
def put_urllist_types(name: str, body: GalleryListTypes, db: Session = Depends(get_db)):
    clean = _checked_list_name(name)
    set_list_types(db, clean, body)
    return _types_view(db, clean)


@router.delete("/urllists/{name}/types", status_code=204)
def delete_urllist_types(name: str, db: Session = Depends(get_db)):
    clear_list_types(db, _checked_list_name(name))


@router.get("/gdl/info")
def gdl_info():
    return get_gallerydl_info()


@router.get("/ytdl/impersonate-targets")
async def ytdl_impersonate_targets():
    targets = await asyncio.to_thread(list_ytdl_impersonate_targets)
    return {"targets": targets}


@router.post("/gdl/update")
async def gdl_update():
    try:
        await asyncio.to_thread(install_gallerydl)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"gallery-dl update failed: {e}") from e
    return {"message": "gallery-dl updated"}
