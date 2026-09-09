"""Audio Originals router — thin wrapper over `services.originals_common`.

Mirror of `api/originals.py` with the audio `OriginalsKind` config and routes
under `/audio-originals`. All `_originals/` path logic lives in
`originals_common`.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.schemas import OriginalsSummary
from app.services import originals_common
from app.services.audio_scanner import rescan_audio_file
from app.services.originals_common import OriginalsKind

router = APIRouter(prefix="/audio-originals", tags=["audio-originals"])

AUDIO_ORIGINALS = OriginalsKind(
    library_model=AudioLibrary,
    file_model=AudioFile,
    rescan_fn=rescan_audio_file,
    route_prefix="/audio-originals",
    reset_at_field="compressed_at",
)


class OriginalPathRequest(BaseModel):
    path: str


class BulkOriginalPathsRequest(BaseModel):
    paths: list[str]


@router.get("", response_model=OriginalsSummary)
def list_originals(library_id: int | None = None, db: Session = Depends(get_db)):
    kind = AUDIO_ORIGINALS
    if library_id is not None:
        lib = db.get(kind.library_model, library_id)
        if not lib:
            raise HTTPException(404, "Library not found")
        libs = [lib]
    else:
        libs = db.query(kind.library_model).order_by(kind.library_model.name).all()

    all_entries: list[dict] = []
    for lib in libs:
        all_entries.extend(originals_common.scan_library_originals(kind, lib, db))

    return OriginalsSummary(**originals_common.build_summary(all_entries))


@router.delete("/file", status_code=204)
def delete_original(body: OriginalPathRequest, db: Session = Depends(get_db)):
    originals_common.delete_original(db, body.path)


@router.post("/restore", status_code=200)
def restore_original(body: OriginalPathRequest, db: Session = Depends(get_db)):
    restore_path = originals_common.restore_one(AUDIO_ORIGINALS, db, body.path)
    return {"message": "Restored", "path": restore_path}


@router.post("/restore-batch", status_code=200)
def restore_originals_batch(body: BulkOriginalPathsRequest, db: Session = Depends(get_db)):
    restored = 0
    failed: list[dict] = []
    for path in body.paths:
        try:
            originals_common.restore_one(AUDIO_ORIGINALS, db, path)
            restored += 1
        except HTTPException as e:
            failed.append({"path": path, "error": e.detail})
        except Exception as e:
            failed.append({"path": path, "error": str(e)})
    return {"restored": restored, "failed": failed}


@router.delete("/library/{library_id}", status_code=204)
def delete_library_originals(library_id: int, db: Session = Depends(get_db)):
    originals_common.delete_library_originals(AUDIO_ORIGINALS, db, library_id)
