# Duplicate Criteria Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users toggle which of the three duplicate-matching criteria (size, duration, pHash) are active before running a scan.

**Architecture:** The POST endpoint gains an optional request body carrying the three boolean flags; `find_duplicates()` receives those flags and skips disabled pipeline stages. The frontend adds three checkboxes above the Scan button; the checked state is local and passed in the API call. No schema migrations, no persistence.

**Tech Stack:** FastAPI + Pydantic (backend), React + TypeScript (frontend), existing `duplicates.py` pipeline.

---

## File map

| File | Change |
|---|---|
| `backend/app/services/duplicates.py` | Add `use_size`, `use_duration`, `use_phash` params to `find_duplicates`; adapt pipeline |
| `backend/app/api/libraries.py` | Add `DuplicateCriteriaRequest` Pydantic model; pass flags to `find_duplicates` via `enqueue` |
| `frontend/src/lib/api.ts` | Add `DuplicateCriteria` interface; update `findDuplicates` to POST with body |
| `frontend/src/pages/Duplicates.tsx` | Add `criteria` state + checkbox panel; pass criteria to `handleScan` |

---

### Task 1: Update `find_duplicates` service

**Files:**
- Modify: `backend/app/services/duplicates.py`

Context: `find_duplicates` currently takes only `library_id`. The pipeline is:
1. Query files whose size appears >1 time → candidates
2. Group by exact size → `by_size` dict
3. For each size group → `_cluster_by_duration` → duration clusters
4. For each duration cluster → `_cluster_by_phash` → `DuplicateGroup`

With optional criteria, each stage becomes conditional.

- [ ] **Step 1: Open the file and read the current `find_duplicates` function** at `backend/app/services/duplicates.py` lines 104–137.

- [ ] **Step 2: Replace `find_duplicates` with the updated version**

```python
def find_duplicates(
    library_id: int,
    use_size: bool = True,
    use_duration: bool = True,
    use_phash: bool = True,
) -> list[DuplicateGroup]:
    _results.pop(library_id, None)
    db = SessionLocal()
    try:
        if use_size:
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
            size_groups = list(by_size.values())
        else:
            candidates = db.query(File).filter(File.library_id == library_id).all()
            size_groups = [candidates]
    finally:
        db.close()

    confirmed: list[DuplicateGroup] = []
    for size_group in size_groups:
        if len(size_group) < 2:
            continue
        if use_duration:
            dur_clusters = _cluster_by_duration(size_group)
        else:
            dur_clusters = [size_group]

        for dur_cluster in dur_clusters:
            if len(dur_cluster) < 2:
                continue
            if use_phash:
                phash_groups = _cluster_by_phash(dur_cluster)
            else:
                phash_groups = [dur_cluster]

            for group in phash_groups:
                if len(group) >= 2:
                    confirmed.append(DuplicateGroup(
                        files=group,
                        keep_id=_pick_keep(group),
                    ))

    _results[library_id] = confirmed
    return confirmed
```

- [ ] **Step 3: Verify the file parses cleanly**

```bash
cd /home/raslan/transcoder
python -c "from app.services.duplicates import find_duplicates; print('OK')"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/duplicates.py
git commit -m "feat: add use_size/use_duration/use_phash params to find_duplicates"
```

---

### Task 2: Update the POST endpoint

**Files:**
- Modify: `backend/app/api/libraries.py`

Context: The endpoint at line 240 currently calls `await enqueue(None, find_duplicates, library_id)` with no body. We need a Pydantic request body and to forward the flags.

- [ ] **Step 1: Add `DuplicateCriteriaRequest` near the other request models** at the top of `backend/app/api/libraries.py` (after the existing imports, alongside `TranscodeRequest`):

```python
class DuplicateCriteriaRequest(BaseModel):
    use_size: bool = True
    use_duration: bool = True
    use_phash: bool = True
```

- [ ] **Step 2: Add `Body` to the fastapi import** at the top of `backend/app/api/libraries.py` — find the line `from fastapi import ...` and add `Body` to it.

- [ ] **Step 3: Update the endpoint signature and body** — replace the existing `find_duplicates_endpoint`:

```python
@router.post("/{library_id}/find-duplicates", status_code=202)
async def find_duplicates_endpoint(
    library_id: int,
    body: DuplicateCriteriaRequest = Body(default=DuplicateCriteriaRequest()),
    db: Session = Depends(get_db),
):
    lib = db.get(Library, library_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index files before checking for duplicates")
    from app.services.duplicates import find_duplicates
    await enqueue(None, find_duplicates, library_id, body.use_size, body.use_duration, body.use_phash)
    return {"message": "Duplicate scan queued"}
```

- [ ] **Step 3: Verify the app starts**

```bash
cd /home/raslan/transcoder
python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/libraries.py
git commit -m "feat: accept duplicate criteria flags in find-duplicates endpoint"
```

---

### Task 3: Update `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`

Context: `findDuplicates` at line 196 is currently `(id: number) => req(...)` with no body. We need a `DuplicateCriteria` interface and to POST it.

- [ ] **Step 1: Add the `DuplicateCriteria` interface** — add it near the other interfaces in `api.ts` (alongside `DuplicateGroup`, `DuplicateFile`):

```typescript
export interface DuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  use_phash: boolean;
}
```

- [ ] **Step 2: Update `findDuplicates`** — replace line 196:

```typescript
findDuplicates: (id: number, criteria: DuplicateCriteria) =>
  req<{ message: string }>(`/libraries/${id}/find-duplicates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  }),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/raslan/transcoder/frontend
npm run build 2>&1 | tail -5
```

Expected: build succeeds (zero type errors). If it fails with "Expected N arguments, got M" on `findDuplicates` call sites, that's expected — fix in Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add DuplicateCriteria interface and update findDuplicates signature"
```

---

### Task 4: Update `Duplicates.tsx`

**Files:**
- Modify: `frontend/src/pages/Duplicates.tsx`

Context: `handleScan` calls `api.findDuplicates(selectedId)` at line 164. The page description says "identical size, duration, and first frame" — update it too. The criteria panel goes between the `<h1>` block and the Scan button row.

- [ ] **Step 1: Add `DuplicateCriteria` to the import** — update line 6:

```typescript
import { api, DuplicateGroup, DuplicateFile, Library, DuplicateCriteria } from "@/lib/api";
```

- [ ] **Step 2: Add criteria state** inside the `Duplicates` component, after the existing `useState` declarations:

```typescript
const [criteria, setCriteria] = useState<DuplicateCriteria>({
  use_size: true,
  use_duration: true,
  use_phash: true,
});
```

- [ ] **Step 3: Update `handleScan`** — pass criteria to `findDuplicates`:

```typescript
const handleScan = async () => {
  if (!selectedId) return;
  stopPolling();
  setScanning(true);
  setGroups(null);
  setKeepIds({});
  try {
    await api.findDuplicates(selectedId, criteria);
  } catch {
    setScanning(false);
    return;
  }
  pollRef.current = setInterval(async () => {
    try {
      const result = await api.getDuplicates(selectedId);
      setGroups(result);
      const init: Record<number, number> = {};
      result.forEach((g, i) => { init[i] = g.keep_id; });
      setKeepIds(init);
      stopPolling();
      setScanning(false);
    } catch (e: any) {
      if (!e?.message?.startsWith("404")) {
        stopPolling();
        setScanning(false);
      }
    }
  }, 2000);
};
```

- [ ] **Step 4: Add the criteria panel and update the subtitle** — replace the header block (the `<div className="flex items-start justify-between gap-4">` block, lines 222–247) with:

```tsx
<div className="space-y-4">
  <div className="flex items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Find videos matching the selected criteria.
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
      <Button
        onClick={handleScan}
        disabled={scanning || !selectedId || (!criteria.use_size && !criteria.use_duration && !criteria.use_phash)}
      >
        {scanning ? (
          <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Scanning…</>
        ) : (
          <><ShieldCheck className="h-3.5 w-3.5 mr-2" />Scan for Duplicates</>
        )}
      </Button>
    </div>
  </div>

  <div className="flex items-center gap-6">
    <SectionHeader>Match Criteria</SectionHeader>
    {(
      [
        { key: "use_size",     label: "Exact size" },
        { key: "use_duration", label: "Duration (±1s)" },
        { key: "use_phash",    label: "Visual (pHash)" },
      ] as { key: keyof DuplicateCriteria; label: string }[]
    ).map(({ key, label }) => (
      <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={criteria[key]}
          onChange={(e) => setCriteria((prev) => ({ ...prev, [key]: e.target.checked }))}
          className="accent-[var(--px-accent)] h-3.5 w-3.5"
        />
        <span className="text-sm text-muted-foreground">{label}</span>
      </label>
    ))}
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd /home/raslan/transcoder/frontend
npm run build 2>&1 | tail -5
```

Expected: build completes with zero errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Duplicates.tsx
git commit -m "feat: add match criteria checkboxes to Duplicates page"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Rebuild and start the container**

```bash
cd /home/raslan/transcoder
docker compose up --build
```

- [ ] **Step 2: Open http://localhost:7899 → Duplicates page**

Verify:
- Three checkboxes render below the page title, all checked by default
- Unchecking all three disables the Scan button
- Re-checking any one re-enables it

- [ ] **Step 3: Run a scan with all three checked** — confirm results appear as before (existing behaviour unchanged).

- [ ] **Step 4: Run a scan with only "Exact size" checked** — confirm it returns results (same-size groups without duration/pHash filtering). Expect more groups than the strict scan.

- [ ] **Step 5: Run a scan with only "Visual (pHash)" checked** — confirm the backend runs without crashing (it will query all files, skip size/duration, run pHash). This will be slow on large libraries.
