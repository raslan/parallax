# Image Library Management — Design Spec

## Goal

Add an Images section to Parallax that lets users scan personal image libraries, find near-duplicate images, detect sensitive content with configurable thresholds, and search images by what they contain — all locally, with no external APIs.

## Context

Parallax already manages video libraries. The Images section is a peer feature inside the same Docker container, sharing the job queue, SQLite database, settings infrastructure, and React frontend. It does not share scanners, models, or data tables with the video side.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Image loading | Pillow (JPEG, PNG, WebP, GIF) |
| Perceptual hashing | `imagehash` library (pHash, 64-bit) |
| Body part detection | NudeNet (ONNX, ~100MB model) |
| Semantic search | SigLIP via ONNX (~450MB vision + text encoders) |
| ML runtime | `onnxruntime-gpu` (falls back to CPU automatically) |
| Model storage | `/app/data/models/` — downloaded on first scan, persisted across rebuilds |

No PyTorch. Everything runs through ONNX Runtime. GPU is used if passed through via Docker; CPU otherwise — same binary, same code path.

---

## Data Model

### `image_libraries`

Mirrors the existing `libraries` table. Independent — a folder can be registered as both a video library and an image library without conflict.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| path | TEXT | Filesystem path |
| name | TEXT | Display name |
| last_scanned_at | DATETIME | Nullable |

### `images`

One row per image file found during scan.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| library_id | INTEGER FK | → image_libraries |
| path | TEXT | Absolute path on disk |
| filename | TEXT | |
| extension | TEXT | jpeg / png / webp / gif |
| size | INTEGER | Bytes |
| width | INTEGER | Pixels |
| height | INTEGER | Pixels |
| exif_date | REAL | Unix timestamp, nullable |
| exif_gps | TEXT | JSON `{lat, lon}`, nullable |
| exif_camera | TEXT | Make + model string, nullable |
| phash | INTEGER | 64-bit perceptual hash, nullable |
| siglip_embedding | TEXT | JSON array of 512 floats, nullable |
| status | TEXT | `pending` / `scanned` / `quarantined` / `failed` |
| scan_error | TEXT | Nullable |
| scanned_at | DATETIME | Nullable |
| created_at | DATETIME | |

### `image_detections`

One row per NudeNet detection. Separate table so confidence-threshold queries are efficient.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| image_id | INTEGER FK | → images |
| label | TEXT | e.g. `FEMALE_BREAST_EXPOSED` |
| confidence | REAL | 0.0 – 1.0 |
| bbox_json | TEXT | JSON `[x, y, w, h]` |

---

## ML Pipeline

### Model Download

Models are downloaded to `/app/data/models/` on first scan. The scan job logs "Downloading models…" and waits before processing images. Subsequent scans skip download if models are present.

- NudeNet: auto-downloaded by the `nudenet` package to its cache, symlinked into `/app/data/models/nudenet/`
- SigLIP ONNX: downloaded via `huggingface_hub` from a pinned ONNX export — vision encoder + text encoder stored separately

### Per-Image Processing

For each image the scanner runs in order:

1. **Load** — Pillow opens the file. GIFs: `Image.seek(0)` extracts frame 0, treated as static from this point.
2. **Metadata** — width, height, extension, file size extracted. EXIF parsed if present (date, GPS, camera model).
3. **pHash** — if enabled: `imagehash.phash(img)` → stored as integer.
4. **NudeNet** — if enabled: `NudeDetector().detect(path)` → each detection written to `image_detections`. Images with zero detections get no rows.
5. **SigLIP embedding** — if enabled: image passed through SigLIP vision encoder → 512-float vector stored as JSON in `images.siglip_embedding`.

Status set to `scanned` on success, `failed` on any exception with `scan_error` populated.

### Scan Options

Before starting, the user sees three toggles:

- **Duplicates** (pHash) — always fast, on by default
- **Content Review** (NudeNet) — moderate cost on CPU, on by default
- **Semantic Search** (SigLIP) — heaviest on CPU, on by default

All three default on. User can disable any before starting. No ETA shown.

### Underscore Directory Exclusion

Directories whose names begin with `_` are excluded from scanning (e.g. `_quarantine/`, `_originals/`). This prevents the scanner from indexing its own quarantine output.

---

## Quarantine

When an image is quarantined it is moved to a `_quarantine/` subdirectory inside the same folder as the source file — identical pattern to how the video transcoder uses `_originals/`.

```
/media/photos/holiday/
  IMG_001.jpg        ← original location
  _quarantine/
    IMG_001.jpg      ← quarantined
```

`images.status` is set to `quarantined`. The file remains in the DB. From the Quarantined page the user can:
- **Restore** — move back to original path, status reset to `scanned`
- **Delete permanently** — remove from disk and DB

`_quarantine/` and `_originals/` coexist safely in the same directory: video and image scanners ignore each other's extensions and both exclude `_`-prefixed subdirectories.

---

## API Routes

All prefixed `/api/images`.

| Method | Path | Description |
|---|---|---|
| GET | `/libraries` | List image libraries |
| POST | `/libraries` | Add image library |
| DELETE | `/libraries/{id}` | Remove library |
| POST | `/libraries/{id}/scan` | Start scan job |
| GET | `/images` | List images (paginated, filterable, sortable) |
| GET | `/images/{id}/thumbnail` | Serve JPEG thumbnail |
| GET | `/images/{id}/full` | Serve original file |
| POST | `/images/{id}/quarantine` | Quarantine single image |
| POST | `/images/quarantine-bulk` | Quarantine selected IDs |
| GET | `/images/quarantined` | List quarantined images |
| POST | `/images/{id}/restore` | Restore from quarantine |
| DELETE | `/images/{id}` | Permanently delete |
| GET | `/images/duplicates` | Get pHash clusters |
| GET | `/images/search` | SigLIP semantic search (query param: `q`) |
| GET | `/images/detections` | Filter by NudeNet labels + confidence |

---

## Frontend Pages

Navigation structure:

```
VIDEOS
  Libraries
  Files
  Duplicates
  Cleanup
  Originals

IMAGES
  Libraries
  Images
  Duplicates
  Content Review
  Quarantined

Jobs
Settings
```

### Image Libraries

Identical UX to video Libraries page. Path input to add a folder, scan button, last scanned timestamp, image count badge. Scan triggers a job visible on the Jobs page.

### Images

Grid browser. Thumbnails generated at scan time (same pattern as video thumbnails, stored in `/app/data/image-thumbnails/`).

- **Sort:** filename, size, date (EXIF date preferred, file date fallback), resolution (width × height)
- **Filter:** format (jpeg/png/webp/gif), status, has detections (any / exposed only / none)
- **Selection mode:** same pattern as Files page — "Select" toggle button activates checkboxes, bulk quarantine action bar appears at bottom

### Duplicates

pHash clustering. Images within a configurable Hamming distance threshold (default: ≤ 10 bits different) are grouped into clusters. UI shows clusters as card groups — user picks which to keep, quarantines the rest. Same selection + bulk action pattern as video Duplicates.

### Content Review

Two-panel layout:

**Left panel — NudeNet filters:**
- Grouped checkboxes by category:
  - Exposed (FEMALE_BREAST_EXPOSED, MALE_GENITALIA_EXPOSED, FEMALE_GENITALIA_EXPOSED, BUTTOCKS_EXPOSED)
  - Covered (FEMALE_BREAST_COVERED, BUTTOCKS_COVERED, MALE_GENITALIA_COVERED)
  - Other (BELLY_EXPOSED, ARMPITS_EXPOSED, FEET_EXPOSED)
- Global confidence threshold slider (0.0 – 1.0, default 0.7)
- "Exposed only" preset button for convenience

**Right panel — Semantic search:**
- Text input: "Search for images containing…"
- Embeds query via SigLIP text encoder at search time
- Cosine similarity against stored `siglip_embedding` values
- Returns top-N results ranked by similarity

Both filters compose: results are images matching the NudeNet criteria AND the semantic search (if both are active). Either can be used independently.

Results displayed in the same selection grid as the Images page. Bulk quarantine button in action bar.

### Quarantined

Lists all images with status `quarantined`, grouped by source library. Each row shows filename, original path, quarantine date, thumbnail. Per-image actions: Restore, Delete. Bulk selection for bulk restore or bulk delete.

---

## Jobs Integration

Image scan jobs appear on the shared Jobs page with a new type label `image-scan`. Job record includes:
- `total_files`, `processed_files`, `progress` (same fields as video jobs)
- `current_file` for live progress display
- SSE progress stream on same `/api/jobs/{id}/progress` endpoint

---

## Settings

New **Images** subsection in Settings:

- **Default NudeNet confidence threshold** — global default for Content Review (0.0–1.0, default 0.7)
- **Default scan options** — which analyses are pre-checked when starting a scan (Duplicates / Content Review / Semantic Search)
- **Thumbnail size** — small / medium / large grid density

---

## Migration

New tables (`image_libraries`, `images`, `image_detections`) added via `Base.metadata.create_all()` — no ALTER TABLE migrations needed since these are new tables with no existing rows.

New `image-scan` job type added to the `JobType` enum.

---

## Out of Scope

- HEIC, RAW formats (can be added later via `pillow-heif` / `rawpy`)
- Animated GIF preview on hover
- Image editing / cropping
- Face recognition / identification
- Cloud sync
- Light mode
