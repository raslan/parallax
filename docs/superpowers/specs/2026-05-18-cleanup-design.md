# Cleanup Page — Design Spec

**Date:** 2026-05-18
**Scope:** Dedicated page to filter a library's indexed files by any combination of duration, frame rate, file date, and resolution, with bulk deletion to `_originals/`

---

## Problem

Short clips, low-resolution recordings, or old files sometimes accumulate in a library. There is no way to find and remove them in bulk. The Cleanup page adds combinable filters so the user can query "show me everything under 30 seconds and older than a month" and delete the results safely.

---

## New DB Columns

Four columns added to the `files` table via lightweight migration in `init_db()`:

| Column | Type | Source |
|---|---|---|
| `file_width` | `INTEGER` nullable | `streams[0].width` from ffprobe |
| `file_height` | `INTEGER` nullable | `streams[0].height` from ffprobe |
| `file_fps` | `REAL` nullable | `streams[0].r_frame_rate` parsed from fraction (e.g. `"30000/1001"` → `29.97`) |
| `file_date` | `REAL` nullable | `format.tags.creation_time` parsed to unix timestamp if present, else `os.path.getmtime(path)` |

Migrations (added to the existing `init_db` migration list):
```python
"ALTER TABLE files ADD COLUMN file_width INTEGER",
"ALTER TABLE files ADD COLUMN file_height INTEGER",
"ALTER TABLE files ADD COLUMN file_fps REAL",
"ALTER TABLE files ADD COLUMN file_date REAL",
```

---

## Scanner Changes

`probe_file()` in `app/services/scanner.py` currently fetches:
```
-show_entries stream=codec_name,codec_type,duration,bit_rate
-show_entries format=size,duration,bit_rate
```

Expand to:
```
-show_entries stream=codec_name,codec_type,duration,bit_rate,width,height,r_frame_rate
-show_entries format=size,duration,bit_rate,tags
```

In the file-scanning logic, after calling `probe_file()`, extract and store the new fields:

```python
# width / height
stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
file_obj.file_width  = stream.get("width")
file_obj.file_height = stream.get("height")

# fps — r_frame_rate is a fraction string e.g. "30000/1001"
raw_fps = stream.get("r_frame_rate", "")
if "/" in raw_fps:
    num, den = raw_fps.split("/")
    file_obj.file_fps = round(int(num) / int(den), 3) if int(den) else None
else:
    file_obj.file_fps = float(raw_fps) if raw_fps else None

# file_date — embedded creation_time preferred, mtime fallback
creation_time_str = data.get("format", {}).get("tags", {}).get("creation_time")
if creation_time_str:
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(creation_time_str.replace("Z", "+00:00"))
        file_obj.file_date = dt.timestamp()
    except ValueError:
        file_obj.file_date = os.path.getmtime(path)
else:
    file_obj.file_date = os.path.getmtime(path)
```

---

## File Model

Add four new columns to `app/models/file.py`:

```python
file_width:  Mapped[int]   = mapped_column(Integer, nullable=True)
file_height: Mapped[int]   = mapped_column(Integer, nullable=True)
file_fps:    Mapped[float] = mapped_column(Float,   nullable=True)
file_date:   Mapped[float] = mapped_column(Float,   nullable=True)
```

---

## API

### GET `/api/libraries/{library_id}/cleanup`

All query parameters optional. Any combination is ANDed.

| Parameter | Type | Meaning |
|---|---|---|
| `duration_op` | `"lt"` \| `"gt"` | shorter than / longer than |
| `duration_secs` | float | threshold in seconds |
| `fps_op` | `"lt"` \| `"gt"` | below / above |
| `fps_val` | float | threshold in fps |
| `date_op` | `"before"` \| `"after"` | older than / newer than |
| `date_ts` | float | unix timestamp threshold |
| `height_op` | `"lt"` \| `"gt"` | below / above |
| `height_val` | int | height in pixels (e.g. 720) |

Returns `list[FileRead]` — the existing schema, reused as-is. Excludes files not on disk. Returns 422 if no filters provided (must supply at least one). Returns 422 if the library has no indexed files.

Implementation: pure SQLAlchemy query, no background job, no polling.

### DELETE `/api/libraries/{library_id}/cleanup`

Body: `{ "file_ids": [int, ...] }`

For each file ID: move the file to `_originals/` (same logic as duplicate deletion), delete the DB record. Returns 204.

Both endpoints added directly to `app/api/libraries.py`.

---

## FileRead Schema Update

Add the four new fields to `FileRead` in `app/schemas.py` so they flow through to the frontend:

```python
file_width:  Optional[int]   = None
file_height: Optional[int]   = None
file_fps:    Optional[float] = None
file_date:   Optional[float] = None
```

Also update `_to_file_read()` in `app/api/files.py` and the inline `to_read()` in `app/api/libraries.py` to include them.

---

## Frontend

### New page: `src/pages/Cleanup.tsx`

Route: `/cleanup`
Sidebar icon: `Scissors` (lucide-react, not yet used)

**Layout — top section:**

Library selector + "Find Files" button in the header row.

Filter panel below: four filter rows, each with an enable checkbox on the left. Disabled rows are greyed out and their inputs ignored.

```
[ ] Duration     [shorter than ▾]  [ H ] : [ M ] : [ S ]
[ ] Frame rate   [below ▾]          [ fps input         ]
[ ] File date    [older than ▾]     [ N ] [ days ▾      ]
[ ] Resolution   [below ▾]          [ px input  ] px height
```

"Find Files" is enabled as long as at least one filter row is checked and the library has files.

**Layout — results section:**

Appears after a successful query. Shows a count ("23 files match"). Above the table: "Select All" checkbox + "Delete Selected" button (disabled until ≥1 row checked).

Table columns: thumbnail (small), filename, resolution (e.g. `1280×720`), fps, duration, file date, size. Each row has a checkbox.

"Delete Selected" calls DELETE `/cleanup`, confirms first (`"Move N file(s) to _originals/ and remove from library?"`), removes matching rows from the table on success. If all rows are deleted the table is replaced with a "No files remaining" empty state.

**Empty states:**
- No filters active yet: "Set at least one filter and click Find Files"
- Query returned 0 results: "No files match the current filters"

### API additions to `src/lib/api.ts`

```typescript
getCleanupFiles: (id: number, params: CleanupParams) => req<VideoFile[]>(`/libraries/${id}/cleanup?${buildQuery(params)}`)
deleteCleanupFiles: (id: number, file_ids: number[]) =>
  req<void>(`/libraries/${id}/cleanup`, { method: "DELETE", body: JSON.stringify({ file_ids }) })
```

Where `CleanupParams`:
```typescript
interface CleanupParams {
  duration_op?: "lt" | "gt";
  duration_secs?: number;
  fps_op?: "lt" | "gt";
  fps_val?: number;
  date_op?: "before" | "after";
  date_ts?: number;
  height_op?: "lt" | "gt";
  height_val?: number;
}
```

Also add `file_width`, `file_height`, `file_fps`, `file_date` to the `VideoFile` interface.

### Sidebar + routing

- Add `Scissors` to the lucide import in `Sidebar.tsx`
- Add `{ to: "/cleanup", icon: Scissors, label: "Cleanup" }` to `navItems` after Duplicates
- Add `<Route path="/cleanup" element={<Cleanup />} />` in `App.tsx`

---

## Data Flow

```
User enables filters, clicks "Find Files"
  → GET /libraries/{id}/cleanup?duration_op=lt&duration_secs=30&...
  → Backend builds ANDed SQLAlchemy query, returns matching FileRead list
  → Frontend renders results table with checkboxes

User selects files, clicks "Delete Selected"
  → Confirmation dialog
  → DELETE /libraries/{id}/cleanup { file_ids: [...] }
  → Files moved to _originals/, DB records deleted
  → Rows removed from table
```

---

## Error Handling

- No filters enabled → "Find Files" button disabled
- Library not scanned → 422 returned, shown as inline error
- File not on disk when deleting → skip silently, still remove DB record
- `file_fps` / `file_date` / `file_width` / `file_height` null for a file → that file is excluded from filter results that require the field

---

## Out of Scope

- Filters on audio codec, bitrate, container format, HDR metadata
- Saving/naming filter presets
- Sorting the results table
- Pagination of results
