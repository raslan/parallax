import os
import shutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.library import Library
from app.models.file import File, FileStatus

router = APIRouter(prefix="/originals", tags=["originals"])


class OriginalEntry(BaseModel):
    path: str
    filename: str
    library_id: int
    library_name: str
    original_size: int
    current_path: str | None
    current_size: int | None
    savings_bytes: int | None  # negative means the transcode made it larger


class OriginalsSummary(BaseModel):
    entries: list[OriginalEntry]
    total_original_bytes: int
    total_current_bytes: int
    total_savings_bytes: int


class OriginalPathRequest(BaseModel):
    path: str


def _scan_library_originals(library: Library) -> list[OriginalEntry]:
    entries = []
    base = library.path.rstrip("/")
    if not os.path.isdir(base):
        return entries

    for root, _dirs, files in os.walk(base):
        if os.path.basename(root) != "_originals":
            continue
        parent_dir = os.path.dirname(root)
        for filename in sorted(files):
            original_path = os.path.join(root, filename)
            try:
                original_size = os.path.getsize(original_path)
            except OSError:
                continue

            current_path = os.path.join(parent_dir, filename)
            # Transcode may have changed the extension (e.g. .webm → .mkv) —
            # fall back to any same-stem file in the parent dir
            if not os.path.exists(current_path):
                stem = os.path.splitext(filename)[0]
                try:
                    for candidate in os.listdir(parent_dir):
                        c_stem, _ = os.path.splitext(candidate)
                        if c_stem == stem and candidate != filename:
                            full = os.path.join(parent_dir, candidate)
                            if os.path.isfile(full):
                                current_path = full
                                break
                except OSError:
                    pass
            current_size: int | None = None
            if os.path.exists(current_path):
                try:
                    current_size = os.path.getsize(current_path)
                except OSError:
                    pass

            savings = (original_size - current_size) if current_size is not None else None

            entries.append(OriginalEntry(
                path=original_path,
                filename=filename,
                library_id=library.id,
                library_name=library.name,
                original_size=original_size,
                current_path=current_path if os.path.exists(current_path) else None,
                current_size=current_size,
                savings_bytes=savings,
            ))

    return entries


@router.get("", response_model=OriginalsSummary)
def list_originals(library_id: int | None = None, db: Session = Depends(get_db)):
    if library_id is not None:
        libs = [db.get(Library, library_id)]
        if not libs[0]:
            raise HTTPException(404, "Library not found")
    else:
        libs = db.query(Library).order_by(Library.name).all()

    all_entries: list[OriginalEntry] = []
    for lib in libs:
        all_entries.extend(_scan_library_originals(lib))

    total_orig    = sum(e.original_size for e in all_entries)
    total_current = sum(e.current_size  for e in all_entries if e.current_size is not None)
    total_savings = sum(e.savings_bytes for e in all_entries if e.savings_bytes is not None)

    return OriginalsSummary(
        entries=all_entries,
        total_original_bytes=total_orig,
        total_current_bytes=total_current,
        total_savings_bytes=total_savings,
    )


@router.delete("/file", status_code=204)
def delete_original(body: OriginalPathRequest, db: Session = Depends(get_db)):
    path = body.path
    if "/_originals/" not in path:
        raise HTTPException(400, "Path is not inside an _originals directory")
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    os.remove(path)
    # Clean up empty _originals dir
    originals_dir = os.path.dirname(path)
    try:
        if not os.listdir(originals_dir):
            os.rmdir(originals_dir)
    except OSError:
        pass


@router.post("/restore", status_code=200)
def restore_original(body: OriginalPathRequest, db: Session = Depends(get_db)):
    path = body.path
    if "/_originals/" not in path:
        raise HTTPException(400, "Path is not inside an _originals directory")
    if not os.path.isfile(path):
        raise HTTPException(404, "Original file not found")

    originals_dir = os.path.dirname(path)
    parent_dir    = os.path.dirname(originals_dir)
    filename      = os.path.basename(path)
    restore_path  = os.path.join(parent_dir, filename)

    # Find the DB record — extension may differ if transcode changed the container
    # (e.g. .webm original transcoded to .mkv)
    file_obj = db.query(File).filter(File.path == restore_path).first()
    if not file_obj:
        stem = os.path.splitext(filename)[0]
        file_obj = (
            db.query(File)
            .filter(File.path.like(os.path.join(parent_dir, stem) + ".%"))
            .first()
        )

    # Delete the transcoded file (use DB path so we get the right extension)
    transcoded_path = file_obj.path if file_obj else restore_path
    if os.path.exists(transcoded_path) and transcoded_path != restore_path:
        os.remove(transcoded_path)
    elif os.path.exists(restore_path):
        os.remove(restore_path)

    shutil.move(path, restore_path)

    # Clean up empty _originals dir
    try:
        if not os.listdir(originals_dir):
            os.rmdir(originals_dir)
    except OSError:
        pass

    # Reset the DB record so the file shows as needing repair again
    if file_obj:
        file_obj.status = FileStatus.CORRUPT
        file_obj.transcoded_at = None
        file_obj.path = restore_path
        file_obj.filename = filename
        try:
            file_obj.size = os.path.getsize(restore_path)
        except OSError:
            pass
        db.commit()

    return {"message": "Restored", "path": restore_path}


@router.delete("/library/{library_id}", status_code=204)
def delete_library_originals(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")

    entries = _scan_library_originals(lib)
    for entry in entries:
        try:
            os.remove(entry.path)
        except OSError:
            pass
        originals_dir = os.path.dirname(entry.path)
        try:
            if not os.listdir(originals_dir):
                os.rmdir(originals_dir)
        except OSError:
            pass
