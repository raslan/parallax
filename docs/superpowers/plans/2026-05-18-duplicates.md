# Duplicate Video Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Duplicates page to Refract that finds, reviews, and safely removes duplicate videos within a library using a three-stage pipeline: exact size → fuzzy duration → perceptual hash of first frame.

**Architecture:** A new `app/services/duplicates.py` service runs the detection pipeline and caches the last result per library in a module-level dict. Three new endpoints (POST to trigger, GET to retrieve, DELETE to act) are added to `app/api/libraries.py`. A new `Duplicates.tsx` page polls the API, renders duplicate groups with thumbnails and a suggested keep, and sends deletion requests that move files to `_originals/`.

**Tech Stack:** Python `imagehash` + `Pillow` for pHash, `ffmpeg` CLI for frame extraction (already available in container), React + shadcn/ui + lucide-react for the frontend.

---

## File Map

**Create:**
- `backend/app/services/duplicates.py` — detection pipeline, pHash extraction, result cache
- `frontend/src/pages/Duplicates.tsx` — new page

**Modify:**
- `backend/requirements.txt` — add `imagehash`, `Pillow`
- `backend/app/schemas.py` — add `DuplicateFileRead`, `DuplicateGroupRead`, `DeleteDuplicatesRequest`
- `backend/app/api/libraries.py` — add three new endpoints + import
- `backend/app/main.py` — no change needed (libraries_router already registered)
- `frontend/src/lib/api.ts` — add `DuplicateFile`, `DuplicateGroup` types + three API calls
- `frontend/src/App.tsx` — add `/duplicates` route
- `frontend/src/components/layout/Sidebar.tsx` — add Duplicates nav item

---

## Task 1: Add Python dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add imagehash and Pillow**

Open `backend/requirements.txt` and add two lines:

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
sqlalchemy==2.0.36
python-multipart==0.0.12
imagehash==4.3.1
Pillow==10.4.0
```

- [ ] **Step 2: Verify they install in the container**

```bash
cd /home/raslan/transcoder
docker compose run --rm transcoder pip install imagehash==4.3.1 Pillow==10.4.0
```

Expected: both packages install successfully with no errors. (`imagehash` will pull in `scipy` and `numpy` as transitive deps — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add imagehash and Pillow for perceptual hashing"
```

---

## Task 2: Add response schemas

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Add the three new schemas to the bottom of `backend/app/schemas.py`**

```python
class DuplicateFileRead(BaseModel):
    id: int
    library_id: int
    path: str
    filename: str
    size: int
    duration: Optional[float] = None
    codec_name: Optional[str] = None
    video_bitrate: Optional[int] = None
    status: str
    has_thumbnail: bool = False

    model_config = {"from_attributes": True}


class DuplicateGroupRead(BaseModel):
    files: list[DuplicateFileRead]
    keep_id: int


class DeleteDuplicatesRequest(BaseModel):
    file_ids: list[int]
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat: add duplicate detection schemas"
```

---

## Task 3: Implement the duplicate detection service

**Files:**
- Create: `backend/app/services/duplicates.py`

- [ ] **Step 1: Create the service file**

Create `backend/app/services/duplicates.py` with the full implementation:

```python
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass

import imagehash
from PIL import Image
from sqlalchemy import func

from app.database import SessionLocal
from app.models.file import File

logger = logging.getLogger(__name__)


@dataclass
class DuplicateGroup:
    files: list[File]
    keep_id: int


# Last result per library_id — cleared on each new scan
_results: dict[int, list[DuplicateGroup]] = {}


def _pick_keep(files: list[File]) -> int:
    """Highest bitrate → largest size → shortest path."""
    return sorted(
        files,
        key=lambda f: (-(f.video_bitrate or 0), -(f.size or 0), f.path),
    )[0].id


def _extract_phash(path: str) -> "imagehash.ImageHash | None":
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", path, "-frames:v", "1", "-q:v", "2", tmp_path],
            capture_output=True,
        )
        if result.returncode != 0 or not os.path.exists(tmp_path):
            return None
        with Image.open(tmp_path) as img:
            return imagehash.phash(img)
    except Exception as exc:
        logger.warning("pHash extraction failed for %s: %s", path, exc)
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _cluster_by_duration(files: list[File], tolerance: float = 1.0) -> list[list[File]]:
    """Group files whose duration is within ±tolerance seconds of each other."""
    groups: list[list[File]] = []
    remaining = list(files)
    while remaining:
        anchor = remaining.pop(0)
        anchor_dur = anchor.duration or 0.0
        group = [anchor]
        rest = []
        for f in remaining:
            if abs((f.duration or 0.0) - anchor_dur) <= tolerance:
                group.append(f)
            else:
                rest.append(f)
        remaining = rest
        if len(group) > 1:
            groups.append(group)
    return groups


def _cluster_by_phash(files: list[File], threshold: int = 10) -> list[list[File]]:
    """Extract pHash for each file and group pairs with Hamming distance ≤ threshold."""
    hashes: list[tuple[File, "imagehash.ImageHash"]] = []
    for f in files:
        if not os.path.exists(f.path):
            logger.warning("File not on disk, skipping: %s", f.path)
            continue
        h = _extract_phash(f.path)
        if h is None:
            continue
        hashes.append((f, h))

    if len(hashes) < 2:
        return []

    groups: list[list[File]] = []
    used: set[int] = set()
    for i, (fi, hi) in enumerate(hashes):
        if i in used:
            continue
        group = [fi]
        used.add(i)
        for j, (fj, hj) in enumerate(hashes):
            if j <= i or j in used:
                continue
            if (hi - hj) <= threshold:
                group.append(fj)
                used.add(j)
        if len(group) > 1:
            groups.append(group)
    return groups


def find_duplicates(library_id: int) -> list[DuplicateGroup]:
    # Clear stale result so GET returns 404 while this scan is in progress
    _results.pop(library_id, None)
    db = SessionLocal()
    try:
        # Stage 1: sizes that appear more than once
        dup_sizes = (
            db.query(File.size)
            .filter(File.library_id == library_id)
            .group_by(File.size)
            .having(func.count(File.id) > 1)
            .all()
        )
        size_values = [row[0] for row in dup_sizes]
        if not size_values:
            _results[library_id] = []
            return []

        candidates = (
            db.query(File)
            .filter(File.library_id == library_id, File.size.in_(size_values))
            .all()
        )

        by_size: dict[int, list[File]] = {}
        for f in candidates:
            by_size.setdefault(f.size, []).append(f)

        confirmed: list[DuplicateGroup] = []

        for size_group in by_size.values():
            # Stage 2: fuzzy duration clustering
            for dur_group in _cluster_by_duration(size_group):
                # Stage 3: perceptual hash
                for phash_group in _cluster_by_phash(dur_group):
                    confirmed.append(DuplicateGroup(
                        files=phash_group,
                        keep_id=_pick_keep(phash_group),
                    ))

        _results[library_id] = confirmed
        return confirmed
    finally:
        db.close()


def get_cached_results(library_id: int) -> list[DuplicateGroup] | None:
    return _results.get(library_id)
```

- [ ] **Step 2: Sanity-check the import resolves inside the container**

```bash
docker compose exec transcoder python -c "from app.services.duplicates import find_duplicates; print('OK')"
```

Expected output: `OK`

If you get `ModuleNotFoundError: No module named 'imagehash'`, run `docker compose up --build -d` first (Task 1 must be complete and the image rebuilt).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/duplicates.py
git commit -m "feat: implement duplicate detection service with pHash pipeline"
```

---

## Task 4: Add API endpoints

**Files:**
- Modify: `backend/app/api/libraries.py`

Three endpoints go at the bottom of `libraries.py`. They use the existing `router` with prefix `/libraries`.

- [ ] **Step 1: Add the import for the new service and schemas at the top of `backend/app/api/libraries.py`**

The existing import block already has `from app.schemas import ...`. Extend it:

```python
from app.schemas import (
    LibraryCreate, LibraryRead, LibraryUpdate, StatsRead,
    BrowseResponse, FileRead, TranscodeRequest,
    DuplicateGroupRead, DuplicateFileRead, DeleteDuplicatesRequest,
)
```

Also add `shutil` to the stdlib imports at the top of the file:

```python
import os
import shutil
```

- [ ] **Step 2: Add the three endpoints at the bottom of `backend/app/api/libraries.py`**

```python
@router.post("/{library_id}/find-duplicates", status_code=202)
async def find_duplicates_endpoint(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index files before checking for duplicates")
    from app.services.duplicates import find_duplicates
    await enqueue(None, find_duplicates, library_id)
    return {"message": "Duplicate scan queued"}


@router.get("/{library_id}/duplicates", response_model=list[DuplicateGroupRead])
def get_duplicates_endpoint(library_id: int, db: Session = Depends(get_db)):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    from app.services.duplicates import get_cached_results
    from app.services.scanner import thumbnail_path
    results = get_cached_results(library_id)
    if results is None:
        raise HTTPException(404, "No duplicate scan has been run for this library yet")
    out = []
    for group in results:
        files = [
            DuplicateFileRead(
                id=f.id,
                library_id=f.library_id,
                path=f.path,
                filename=f.filename,
                size=f.size,
                duration=f.duration,
                codec_name=f.codec_name,
                video_bitrate=f.video_bitrate,
                status=f.status,
                has_thumbnail=os.path.exists(thumbnail_path(f.id)),
            )
            for f in group.files
        ]
        out.append(DuplicateGroupRead(files=files, keep_id=group.keep_id))
    return out


@router.delete("/{library_id}/duplicates", status_code=204)
def delete_duplicates_endpoint(
    library_id: int,
    body: DeleteDuplicatesRequest,
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    for file_id in body.file_ids:
        f = db.get(File, file_id)
        if not f or f.library_id != library_id:
            continue
        if os.path.exists(f.path):
            originals_dir = os.path.join(os.path.dirname(f.path), "_originals")
            os.makedirs(originals_dir, exist_ok=True)
            shutil.move(f.path, os.path.join(originals_dir, f.filename))
        db.delete(f)
    db.commit()
```

- [ ] **Step 3: Rebuild and smoke-test**

```bash
cd /home/raslan/transcoder && docker compose up --build -d
```

Wait ~10 seconds for startup, then:

```bash
curl -s http://localhost:8000/api/libraries | python3 -m json.tool
```

Expected: JSON list of libraries (confirms the server started without import errors).

```bash
# Replace 1 with a real library_id from the list above
curl -s -X POST http://localhost:8000/api/libraries/1/find-duplicates
```

Expected: `{"message": "Duplicate scan queued"}` or a 422 if the library has no indexed files.

```bash
curl -s http://localhost:8000/api/libraries/1/duplicates
```

Expected: `[]` (empty list) or a 404 if the scan hasn't finished yet. Wait a few seconds and retry.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/libraries.py
git commit -m "feat: add duplicate detection and deletion endpoints"
```

---

## Task 5: Add frontend API types and calls

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the TypeScript interfaces after the `Stats` interface in `api.ts`**

```typescript
export interface DuplicateFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  size: number;
  duration: number | null;
  codec_name: string | null;
  video_bitrate: number | null;
  status: string;
  has_thumbnail: boolean;
}

export interface DuplicateGroup {
  files: DuplicateFile[];
  keep_id: number;
}
```

- [ ] **Step 2: Add the three API calls inside the `api` object in `api.ts`**

Add after the `clearJobHistory` line:

```typescript
  // Duplicates
  findDuplicates: (id: number) => req<{ message: string }>(`/libraries/${id}/find-duplicates`, { method: "POST" }),
  getDuplicates: (id: number) => req<DuplicateGroup[]>(`/libraries/${id}/duplicates`),
  deleteDuplicates: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/duplicates`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add duplicate detection API types and calls"
```

---

## Task 6: Build the Duplicates page

**Files:**
- Create: `frontend/src/pages/Duplicates.tsx`

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/Duplicates.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, DuplicateGroup, Library } from "@/lib/api";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";

function LibrarySelector({
  libraries,
  selected,
  onChange,
}: {
  libraries: Library[];
  selected: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select
      className="bg-card border border-border text-sm rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      value={selected ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {libraries.map((lib) => (
        <option key={lib.id} value={lib.id}>
          {lib.name}
        </option>
      ))}
    </select>
  );
}

function FilePanel({
  file,
  isKeep,
  onClick,
}: {
  file: DuplicateGroup["files"][0];
  isKeep: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex-1 min-w-[220px] rounded-lg border p-3 cursor-pointer transition-colors space-y-2 ${
        isKeep
          ? "border-primary/60 bg-primary/5"
          : "border-border hover:border-muted-foreground/40"
      }`}
    >
      {/* Thumbnail */}
      <div className="aspect-video w-full rounded overflow-hidden bg-muted flex items-center justify-center">
        {file.has_thumbnail ? (
          <img
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <Copy className="h-6 w-6 text-muted-foreground" />
        )}
      </div>

      {/* Keep / Delete badge */}
      <div className="flex items-center gap-1.5">
        {isKeep ? (
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Keep</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Will delete</span>
        )}
      </div>

      {/* File info */}
      <p className="text-xs font-medium truncate" title={file.filename}>
        {file.filename}
      </p>
      <p className="text-xs text-muted-foreground truncate" title={file.path}>
        {file.path}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span>{formatSize(file.size)}</span>
        {file.duration != null && <span>{formatDuration(file.duration)}</span>}
        {file.video_bitrate != null && <span>{formatBitrate(file.video_bitrate)}</span>}
        {file.codec_name && (
          <Badge variant="secondary" className="text-xs px-1 py-0">{file.codec_name}</Badge>
        )}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  keepId,
  onFlip,
}: {
  group: DuplicateGroup;
  keepId: number;
  onFlip: (fileId: number) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-normal">
          {group.files.length} copies · {formatSize(group.files[0].size)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {group.files.map((f) => (
            <FilePanel
              key={f.id}
              file={f}
              isKeep={f.id === keepId}
              onClick={() => { if (f.id !== keepId) onFlip(f.id); }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function Duplicates() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  // keepIds overrides per group: groupIndex → file id to keep
  const [keepIds, setKeepIds] = useState<Record<number, number>>({});
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setSelectedId(libs[0].id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleScan = async () => {
    if (!selectedId) return;
    setScanning(true);
    setGroups(null);
    setKeepIds({});
    try {
      await api.findDuplicates(selectedId);
    } catch {
      setScanning(false);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const result = await api.getDuplicates(selectedId);
        setGroups(result);
        // Init keepIds from server suggestion
        const init: Record<number, number> = {};
        result.forEach((g, i) => { init[i] = g.keep_id; });
        setKeepIds(init);
        stopPolling();
        setScanning(false);
      } catch {
        // 404 means scan not done yet — keep polling
      }
    }, 2000);
  };

  const handleFlip = (groupIndex: number, fileId: number) => {
    setKeepIds((prev) => ({ ...prev, [groupIndex]: fileId }));
  };

  const handleDeleteAll = async () => {
    if (!selectedId || !groups) return;
    const toDelete = groups.flatMap((g, i) =>
      g.files.filter((f) => f.id !== (keepIds[i] ?? g.keep_id)).map((f) => f.id)
    );
    if (toDelete.length === 0) return;
    if (!confirm(`Move ${toDelete.length} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    try {
      await api.deleteDuplicates(selectedId, toDelete);
      // Remove deleted files from local state
      setGroups((prev) =>
        prev
          ?.map((g, i) => ({
            ...g,
            files: g.files.filter((f) => f.id === (keepIds[i] ?? g.keep_id)),
          }))
          .filter((g) => g.files.length > 1) ?? []
      );
    } finally {
      setDeleting(false);
    }
  };

  const recoverable = groups
    ? groups.reduce((sum, g, i) => {
        const keepId = keepIds[i] ?? g.keep_id;
        return sum + g.files.filter((f) => f.id !== keepId).reduce((s, f) => s + f.size, 0);
      }, 0)
    : 0;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find videos with identical size, duration, and first frame.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {libraries.length > 0 && (
            <LibrarySelector
              libraries={libraries}
              selected={selectedId}
              onChange={(id) => { setSelectedId(id); setGroups(null); setKeepIds({}); }}
            />
          )}
          <Button onClick={handleScan} disabled={scanning || !selectedId}>
            {scanning ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Scanning…</>
            ) : (
              <><ShieldCheck className="h-3.5 w-3.5 mr-2" />Scan for Duplicates</>
            )}
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {groups !== null && groups.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{groups.length}</span> duplicate group{groups.length !== 1 ? "s" : ""} found
            {recoverable > 0 && (
              <span className="text-muted-foreground ml-2">· {formatSize(recoverable)} recoverable</span>
            )}
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAll}
            disabled={deleting}
          >
            {deleting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Deleting…</>
            ) : (
              <><Trash2 className="h-3.5 w-3.5 mr-2" />Delete All Suggested</>
            )}
          </Button>
        </div>
      )}

      {/* Results */}
      {scanning && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!scanning && groups !== null && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No duplicates found</h3>
            <p className="text-sm text-muted-foreground">
              Every file in this library appears to be unique.
            </p>
          </CardContent>
        </Card>
      )}

      {!scanning && groups && groups.length > 0 && (
        <div className="space-y-4">
          {groups.map((group, i) => (
            <GroupCard
              key={i}
              group={group}
              keepId={keepIds[i] ?? group.keep_id}
              onFlip={(fileId) => handleFlip(i, fileId)}
            />
          ))}
        </div>
      )}

      {/* Initial state — no scan yet */}
      {!scanning && groups === null && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">Ready to scan</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Select a library and click Scan for Duplicates to find matching videos.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Duplicates.tsx
git commit -m "feat: add Duplicates page"
```

---

## Task 7: Wire up routing and navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add the route in `frontend/src/App.tsx`**

Add the import at the top with the other page imports:

```tsx
import { Duplicates } from "@/pages/Duplicates";
```

Add the route inside the `<Route element={<Layout />}>` block, after the Originals route:

```tsx
<Route path="/duplicates" element={<Duplicates />} />
```

- [ ] **Step 2: Add the nav item in `frontend/src/components/layout/Sidebar.tsx`**

Add `Copy` to the lucide import:

```tsx
import { LayoutDashboard, Library, Film, Activity, Settings, Archive, Copy } from "lucide-react";
```

Add the nav item to the `navItems` array, after Originals:

```tsx
{ to: "/duplicates", icon: Copy, label: "Duplicates" },
```

- [ ] **Step 3: Rebuild and verify end-to-end**

```bash
cd /home/raslan/transcoder && docker compose up --build -d
```

Open the app in a browser. Verify:
1. "Duplicates" appears in the sidebar and navigates to the new page
2. Selecting a library and clicking "Scan for Duplicates" shows a spinner
3. If the library has files, the scan completes and shows either groups or the empty state
4. Clicking a non-keep file card flips the suggestion (violet ring moves)
5. "Delete All Suggested" prompts for confirmation and removes the cards on success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: wire up Duplicates page route and nav item"
```
