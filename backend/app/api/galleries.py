import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.gallery_download import GalleryDownload, GalleryDownloadStatus
from app.schemas import (
    ClearGalleriesRequest,
    GalleryEnqueueRequest,
    GalleryOptions,
    UrlFileBody,
)
from app.services.gallery_dl import (
    URLS_FILE,
    cancel_gallery,
    get_gallerydl_info,
    install_gallerydl,
    run_gallery,
    set_gallery_max_parallel,
)
from app.services.gallery_options import load_options, save_options

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

    snapshot = opts.model_dump_json()
    created: list[int] = []

    if opts.inputMode == "file":
        row = GalleryDownload(
            url="file:urls.txt",
            status=GalleryDownloadStatus.PENDING,
            output_dir=opts.baseDir,
            options=snapshot,
        )
        db.add(row)
        db.flush()
        created.append(row.id)
    else:
        for url in [u.strip() for u in req.urls if u.strip()]:
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


@router.get("/urlfile")
def get_urlfile():
    try:
        with open(URLS_FILE, encoding="utf-8") as f:
            return {"text": f.read()}
    except FileNotFoundError:
        return {"text": ""}


@router.put("/urlfile")
def put_urlfile(body: UrlFileBody):
    os.makedirs(os.path.dirname(URLS_FILE), exist_ok=True)
    with open(URLS_FILE, "w", encoding="utf-8") as f:
        f.write(body.text)
    return {"ok": True}


@router.get("/gdl/info")
def gdl_info():
    return get_gallerydl_info()


@router.post("/gdl/update")
async def gdl_update():
    try:
        await asyncio.to_thread(install_gallerydl)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"gallery-dl update failed: {e}") from e
    return {"message": "gallery-dl updated"}
