# Duplicate Video Detection — Design Spec

**Date:** 2026-05-18
**Scope:** Within a single library, on-demand, no persistent hash storage

---

## Problem

The existing `dupes.sh` script matches videos only by file size and blindly deletes the second copy with no review step. The app needs a safer, smarter replacement that:

- Matches on three signals: exact size, fuzzy duration, visual first-frame similarity
- Presents suspected duplicates for human review before any deletion
- Moves deleted files to `_originals/` rather than permanently removing them

---

## Detection Pipeline

Three-stage filter, applied in order of cheapness:

1. **Exact size match** — SQL `GROUP BY size HAVING count > 1`. Uses the existing `files.size` column. Instant.
2. **Fuzzy duration match** — Within each size group, sub-group by `duration` within ±1.0 seconds. Handles re-encoded copies that drift slightly. Uses the existing `files.duration` column. Instant.
3. **Perceptual hash (pHash)** — For each file surviving both filters, extract the first frame via `ffmpeg -frames:v 1` into a temp file, compute pHash using the `imagehash` Python library, compare all pairs by Hamming distance ≤ 10. Files that pass all three stages are confirmed duplicates.

Hashes are **not stored** — computed on demand and discarded. Rationale: size+duration filtering leaves very few candidates in practice, so frame extraction takes seconds, not minutes. No DB migration needed.

---

## Auto-Suggestion (Which Copy to Keep)

Within each confirmed duplicate group, the "keep" suggestion is determined by:

1. Highest `video_bitrate` (best quality)
2. Largest `size` as tiebreaker
3. Shortest path alphabetically as final tiebreaker

The user can override the suggestion per group before deleting.

---

## Backend

### New service: `app/services/duplicates.py`

Single public function:

```python
def find_duplicates(library_id: int) -> list[DuplicateGroup]
```

`DuplicateGroup` is a dataclass containing:
- `files: list[File]` — all copies
- `keep_id: int` — auto-suggested file ID to keep

Internal steps:
1. Load all files for the library from DB
2. Group by exact `size`, discard singletons
3. Sub-group by `duration` within ±1.0s, discard singletons
4. For each candidate sub-group: extract first frame per file into `tempfile.NamedTemporaryFile`, compute pHash, compare all pairs (Hamming distance ≤ 10), collect confirmed groups
5. Apply auto-suggestion logic
6. Return groups (temp files cleaned up via context manager)

### New endpoints in `app/api/libraries.py`

```
POST /api/libraries/{id}/find-duplicates
```
Runs `find_duplicates` via the job queue (`enqueue(None, ...)`), stores result in a module-level dict keyed by `library_id` (last result only, in memory).

```
GET /api/libraries/{id}/duplicates
```
Returns the stored result for the library, or 404 if no scan has been run yet.

```
DELETE /api/libraries/{id}/duplicates
```
Accepts a list of file IDs to delete. Moves each file to `_originals/` (same logic as transcode backup), removes the DB record.

### Dependency

Add `imagehash` and `Pillow` to `requirements.txt` (imagehash depends on Pillow for image loading).

---

## Frontend

### New page: `src/pages/Duplicates.tsx`

Route: `/duplicates`
Sidebar: `Copy` lucide icon

**Layout:**

1. **Library selector** — dropdown of all libraries, defaults to first. "Scan for Duplicates" button triggers the job and polls `GET /duplicates` until results arrive.

2. **Summary bar** (once results load) — "N duplicate groups · X GB recoverable" + two actions:
   - **Delete All Suggested** — deletes the non-keep files across all groups using current selections
   - groups auto-scroll on click for manual review

3. **Duplicate group cards** — one card per group:
   - Files shown side-by-side (flex row, wraps on narrow screens)
   - Each file panel: thumbnail, filename, path (truncated), size, duration, bitrate, codec badge
   - Auto-suggested keep: violet "Keep" badge + subtle ring
   - Others: "Will delete" muted label
   - Clicking a non-keep file flips the suggestion for that group

4. **Empty state** — dashed card: "No duplicates found in [Library Name]"

### API additions to `src/lib/api.ts`

```typescript
findDuplicates: (id: number) => req<{ message: string }>(`/libraries/${id}/find-duplicates`, { method: "POST" })
getDuplicates: (id: number) => req<DuplicateGroup[]>(`/libraries/${id}/duplicates`)
deleteDuplicates: (id: number, file_ids: number[]) => req<void>(`/libraries/${id}/duplicates`, { method: "DELETE", body: JSON.stringify({ file_ids }) })
```

---

## Data Flow

```
User clicks "Scan"
  → POST /find-duplicates → enqueue(find_duplicates, library_id)
  → frontend polls GET /duplicates every 2s
  → results stored in memory, returned on next poll
  → frontend renders groups with auto-suggested keeps

User clicks "Delete All Suggested"
  → DELETE /duplicates { file_ids: [...non-keep ids] }
  → each file moved to _originals/, DB record removed
  → frontend removes deleted groups from view
```

---

## Error Handling

- File not on disk when extracting frame: skip that file, exclude from results
- ffmpeg frame extraction failure: skip that file, log warning
- Library has no indexed files: 422 "Scan the library first"
- Scan already running: 409

---

## Out of Scope

- Cross-library duplicate detection
- Persistent hash storage / incremental scans
- Audio fingerprinting
- Duplicate detection triggered automatically on scan
