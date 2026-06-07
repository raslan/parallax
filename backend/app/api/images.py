import os
import json
import shutil
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, asc, desc, nullslast

from app.database import get_db, DATA_DIR
from app.models.image import ImageFile, ImageDetection, ImageStatus
from app.schemas import ImageRead, ImagesResponse, ImageDetectionRead, ImageSearchResult


class BulkQuarantineRequest(BaseModel):
    ids: list[int]

router = APIRouter(prefix="/images", tags=["images"])

THUMBNAIL_DIR = os.path.join(DATA_DIR, "image-thumbnails")

_SORT_COLUMNS = {
    "filename": ImageFile.filename,
    "size": ImageFile.size,
    "date": ImageFile.exif_date,
    "width": ImageFile.width,
    "height": ImageFile.height,
}


def _detections_for(image_id: int, db: Session) -> list[ImageDetectionRead]:
    rows = db.query(ImageDetection).filter(ImageDetection.image_id == image_id).all()
    return [ImageDetectionRead(
        id=r.id, image_id=r.image_id, label=r.label,
        confidence=r.confidence, bbox_json=r.bbox_json,
    ) for r in rows]


def _to_image_read(f: ImageFile, db: Session) -> ImageRead:
    thumb = os.path.join(THUMBNAIL_DIR, f"{f.id}.jpg")
    return ImageRead(
        id=f.id,
        library_id=f.library_id,
        path=f.path,
        filename=f.filename,
        extension=f.extension,
        size=f.size,
        width=f.width,
        height=f.height,
        exif_date=f.exif_date,
        exif_gps=f.exif_gps,
        exif_camera=f.exif_camera,
        status=f.status,
        scan_error=f.scan_error,
        scanned_at=f.scanned_at,
        created_at=f.created_at,
        has_thumbnail=os.path.exists(thumb),
        detections=_detections_for(f.id, db),
    )


@router.get("", response_model=ImagesResponse)
def list_images(
    library_id: int | None = Query(None),
    status: str | None = Query(None),
    has_detections: str | None = Query(None),  # "any", "exposed", "none"
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10000),
    sort_by: str = Query("filename"),
    sort_dir: str = Query("asc"),
    db: Session = Depends(get_db),
):
    q = db.query(ImageFile)
    if library_id is not None:
        q = q.filter(ImageFile.library_id == library_id)
    if status:
        q = q.filter(ImageFile.status == status)
    else:
        q = q.filter(ImageFile.status != ImageStatus.QUARANTINED)
    if has_detections == "any":
        q = q.filter(ImageFile.id.in_(
            db.query(ImageDetection.image_id).distinct()
        ))
    elif has_detections == "exposed":
        exposed_labels = [
            "FEMALE_BREAST_EXPOSED", "MALE_GENITALIA_EXPOSED",
            "FEMALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
        ]
        q = q.filter(ImageFile.id.in_(
            db.query(ImageDetection.image_id)
            .filter(ImageDetection.label.in_(exposed_labels))
            .distinct()
        ))
    elif has_detections == "none":
        q = q.filter(~ImageFile.id.in_(
            db.query(ImageDetection.image_id).distinct()
        ))

    col = _SORT_COLUMNS.get(sort_by, ImageFile.filename)
    order = nullslast(desc(col)) if sort_dir == "desc" else nullslast(asc(col))
    total = q.with_entities(func.count(ImageFile.id)).scalar()
    items = q.order_by(order).offset((page - 1) * page_size).limit(page_size).all()

    return ImagesResponse(
        items=[_to_image_read(f, db) for f in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/quarantined", response_model=ImagesResponse)
def list_quarantined(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    q = db.query(ImageFile).filter(ImageFile.status == ImageStatus.QUARANTINED)
    total = q.with_entities(func.count(ImageFile.id)).scalar()
    items = q.order_by(ImageFile.filename).offset((page - 1) * page_size).limit(page_size).all()
    return ImagesResponse(
        items=[_to_image_read(f, db) for f in items],
        total=total, page=page, page_size=page_size,
    )


@router.get("/search", response_model=list[ImageSearchResult])
def search_images(
    q: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=100000),
    exclude: bool = Query(False, description="Return least similar images instead of most similar"),
    library_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    from app.services.image_analyzer import encode_text_clip, cosine_similarity
    from app.models.settings import get_setting

    clip_model_id = get_setting(db, "clip_model", "clip-vit-base-patch32")
    text_vec = encode_text_clip(q, model_id=clip_model_id)

    query = db.query(ImageFile).filter(
        ImageFile.clip_embedding.isnot(None),
        ImageFile.status != ImageStatus.QUARANTINED,
    )
    if library_id is not None:
        query = query.filter(ImageFile.library_id == library_id)

    candidates = query.all()
    scored = []
    for f in candidates:
        try:
            img_vec = json.loads(f.clip_embedding)
            score = cosine_similarity(text_vec, img_vec)
            scored.append((f, score))
        except Exception:
            continue

    scored.sort(key=lambda x: x[1], reverse=not exclude)
    return [
        ImageSearchResult(image=_to_image_read(f, db), score=round(score, 4))
        for f, score in scored[:limit]
    ]


@router.get("/detections", response_model=ImagesResponse)
def filter_by_detections(
    labels: str = Query(..., description="Comma-separated NudeNet labels"),
    min_confidence: float = Query(0.7, ge=0.0, le=1.0),
    exclude: bool = Query(False, description="Return images that do NOT match the criteria"),
    library_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    label_list = [l.strip() for l in labels.split(",") if l.strip()]
    if not label_list:
        raise HTTPException(400, "At least one label is required")

    matching_ids = (
        db.query(ImageDetection.image_id)
        .filter(
            ImageDetection.label.in_(label_list),
            ImageDetection.confidence >= min_confidence,
        )
        .distinct()
        .subquery()
    )

    id_filter = ImageFile.id.notin_(matching_ids) if exclude else ImageFile.id.in_(matching_ids)
    q = db.query(ImageFile).filter(id_filter, ImageFile.status != ImageStatus.QUARANTINED)
    if library_id is not None:
        q = q.filter(ImageFile.library_id == library_id)

    total = q.with_entities(func.count(ImageFile.id)).scalar()
    items = q.order_by(ImageFile.filename).offset((page - 1) * page_size).limit(page_size).all()

    return ImagesResponse(
        items=[_to_image_read(f, db) for f in items],
        total=total, page=page, page_size=page_size,
    )


@router.get("/duplicates", response_model=list[list[int]])
def get_image_duplicates(
    library_id: int | None = Query(None),
    threshold: int = Query(10, ge=0, le=64),
    db: Session = Depends(get_db),
):
    from app.services.image_duplicates import cluster_by_phash
    q = db.query(ImageFile.id, ImageFile.phash).filter(
        ImageFile.phash.isnot(None),
        ImageFile.status == ImageStatus.SCANNED,
    )
    if library_id is not None:
        q = q.filter(ImageFile.library_id == library_id)
    images = [{"id": row[0], "phash": row[1]} for row in q.all()]
    return cluster_by_phash(images, threshold=threshold)


@router.post("/quarantine-bulk", status_code=200)
def quarantine_bulk(body: BulkQuarantineRequest, db: Session = Depends(get_db)):
    moved = 0
    for image_id in body.ids:
        f = db.get(ImageFile, image_id)
        if not f or f.status == ImageStatus.QUARANTINED:
            continue
        if not os.path.exists(f.path):
            continue
        q_dir = os.path.join(os.path.dirname(f.path), "_quarantine")
        os.makedirs(q_dir, exist_ok=True)
        dest = os.path.join(q_dir, f.filename)
        shutil.move(f.path, dest)
        f.path = dest
        f.status = ImageStatus.QUARANTINED
        moved += 1
    db.commit()
    return {"moved": moved}


@router.get("/{image_id}/thumbnail")
def get_thumbnail(image_id: int, db: Session = Depends(get_db)):
    f = db.get(ImageFile, image_id)
    if not f:
        raise HTTPException(404, "Image not found")
    thumb = os.path.join(THUMBNAIL_DIR, f"{image_id}.jpg")
    if not os.path.exists(thumb):
        raise HTTPException(404, "Thumbnail not available")
    return FileResponse(thumb, media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})


@router.get("/{image_id}/full")
def get_full(image_id: int, db: Session = Depends(get_db)):
    f = db.get(ImageFile, image_id)
    if not f:
        raise HTTPException(404, "Image not found")
    if not os.path.exists(f.path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(f.path, headers={"Cache-Control": "no-store"})


@router.post("/{image_id}/quarantine", status_code=200)
def quarantine_image(image_id: int, db: Session = Depends(get_db)):
    f = db.get(ImageFile, image_id)
    if not f:
        raise HTTPException(404, "Image not found")
    if f.status == ImageStatus.QUARANTINED:
        raise HTTPException(409, "Image is already quarantined")
    if not os.path.exists(f.path):
        raise HTTPException(404, "File not found on disk")

    q_dir = os.path.join(os.path.dirname(f.path), "_quarantine")
    os.makedirs(q_dir, exist_ok=True)
    dest = os.path.join(q_dir, f.filename)
    shutil.move(f.path, dest)
    f.path = dest
    f.status = ImageStatus.QUARANTINED
    db.commit()
    return {"message": "Quarantined"}


@router.post("/{image_id}/restore", status_code=200)
def restore_image(image_id: int, db: Session = Depends(get_db)):
    f = db.get(ImageFile, image_id)
    if not f:
        raise HTTPException(404, "Image not found")
    if f.status != ImageStatus.QUARANTINED:
        raise HTTPException(409, "Image is not quarantined")

    original_dir = os.path.dirname(os.path.dirname(f.path))  # up from _quarantine/
    dest = os.path.join(original_dir, f.filename)
    if os.path.exists(dest):
        raise HTTPException(409, f"A file named {f.filename} already exists at the original location")

    shutil.move(f.path, dest)
    f.path = dest
    f.status = ImageStatus.SCANNED
    db.commit()
    return {"message": "Restored"}


@router.delete("/{image_id}", status_code=204)
def delete_image(image_id: int, db: Session = Depends(get_db)):
    f = db.get(ImageFile, image_id)
    if not f:
        raise HTTPException(404, "Image not found")
    parent_dir = os.path.dirname(f.path)
    if os.path.exists(f.path):
        os.remove(f.path)
    thumb = os.path.join(THUMBNAIL_DIR, f"{image_id}.jpg")
    if os.path.exists(thumb):
        os.remove(thumb)
    db.query(ImageDetection).filter(ImageDetection.image_id == image_id).delete()
    db.delete(f)
    db.commit()
    if os.path.basename(parent_dir) == "_quarantine":
        try:
            os.rmdir(parent_dir)
        except OSError:
            pass
