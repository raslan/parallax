# Duplicate Scan Job Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give duplicate scans a proper DB-backed Job record so they appear on the Jobs page and the Duplicates page can resume its scanning state after navigation.

**Architecture:** The `find_duplicates_endpoint` currently uses `enqueue(None, ...)` — the `None` means no Job row is created, so the scan is invisible to the rest of the app. Fix: create a `Job` record in the endpoint (like the transcode endpoint does), pass the `job_id` into `find_duplicates`, and have the function mark the job RUNNING → COMPLETED/FAILED. On the frontend, the Duplicates page gains a mount-time check: if a running/pending `"duplicates"` job exists for the selected library, resume the polling loop automatically.

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + TypeScript (frontend), existing `enqueue`/`Job` infrastructure.

---

## File map

| File | Change |
|---|---|
| `backend/app/models/job.py` | Add `DUPLICATES = "duplicates"` to `JobType` |
| `backend/app/services/duplicates.py` | Add `job_id` param; manage RUNNING → COMPLETED/FAILED lifecycle; keep DB open throughout |
| `backend/app/api/libraries.py` | Create Job record before enqueue; pass `job.id`; add duplicate-in-progress guard |
| `frontend/src/pages/Jobs.tsx` | Add `"duplicates": "Duplicate scan"` to `TYPE_LABEL` |
| `frontend/src/pages/Duplicates.tsx` | Extract `startPolling`; add `useEffect` to resume if job already running |

---

### Task 1: Add JobType and update find_duplicates service

**Files:**
- Modify: `backend/app/models/job.py`
- Modify: `backend/app/services/duplicates.py`

Context: `JobType` is a plain class with string constants. `find_duplicates` currently opens a DB session only for the initial file query, then closes it before running the algorithm. We need to keep the session open to update job status at the end, and we need to accept `job_id` as a new parameter.

- [ ] **Step 1: Add DUPLICATES to JobType**

Open `backend/app/models/job.py`. Replace the `JobType` class:

```python
class JobType:
    SCAN = "scan"
    CHECK = "check"
    TRANSCODE = "transcode"
    DUPLICATES = "duplicates"
```

- [ ] **Step 2: Update imports in duplicates.py**

Open `backend/app/services/duplicates.py`. The current imports are:

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
```

Replace them with:

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
from app.models.job import Job, JobStatus
from app.services.common import now
```

- [ ] **Step 3: Replace find_duplicates with the updated version**

The current `find_duplicates` closes the DB after the initial query (line ~144 `finally: db.close()`), then runs the algorithm without DB access. Replace the entire `find_duplicates` function:

```python
def find_duplicates(
    library_id: int,
    job_id: int | None = None,
    use_size: bool = True,
    use_duration: bool = True,
    use_phash: bool = True,
) -> list[DuplicateGroup]:
    db = SessionLocal()
    job = None
    try:
        if job_id is not None:
            job = db.get(Job, job_id)
            if job:
                job.status = JobStatus.RUNNING
                job.started_at = now()
                db.commit()

        _results.pop(library_id, None)

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
                if job:
                    job.status = JobStatus.COMPLETED
                    job.finished_at = now()
                    job.progress = 100.0
                    db.commit()
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

        if job:
            job.status = JobStatus.COMPLETED
            job.finished_at = now()
            job.progress = 100.0
            db.commit()

        return confirmed
    except Exception as e:
        logger.exception("Duplicate scan failed for library %d: %s", library_id, e)
        if job:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.finished_at = now()
            db.commit()
        raise
    finally:
        db.close()
```

- [ ] **Step 4: Verify the module imports cleanly**

```bash
cd /home/raslan/transcoder/backend
python -c "from app.services.duplicates import find_duplicates; from app.models.job import JobType; print(JobType.DUPLICATES, 'OK')"
```

Expected output: `duplicates OK`

- [ ] **Step 5: Commit**

```bash
cd /home/raslan/transcoder
git add backend/app/models/job.py backend/app/services/duplicates.py
git commit -m "feat: add JobType.DUPLICATES and give find_duplicates a job lifecycle"
```

---

### Task 2: Update the POST endpoint to create a Job record

**Files:**
- Modify: `backend/app/api/libraries.py`

Context: The endpoint currently does `await enqueue(None, find_duplicates, library_id, body.use_size, body.use_duration, body.use_phash)`. We need to create a `Job` record first, pass `job.id` as the first argument to `enqueue` (so the queue system can cancel it), and also pass it to `find_duplicates` as the second positional argument so the function can update its status. We also add a duplicate-in-progress guard identical to the one on transcode.

- [ ] **Step 1: Replace the find_duplicates_endpoint function**

Open `backend/app/api/libraries.py`. Find and replace the `find_duplicates_endpoint` function (currently at the `@router.post("/{library_id}/find-duplicates", ...)` decorator):

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
    if not body.use_size and not body.use_duration and not body.use_phash:
        raise HTTPException(422, "At least one matching criterion must be selected")
    file_count = db.query(func.count(File.id)).filter(File.library_id == library_id).scalar()
    if file_count == 0:
        raise HTTPException(422, "Scan the library first to index files before checking for duplicates")
    if active_job_exists(db, library_id, JobType.DUPLICATES):
        raise HTTPException(409, "A duplicate scan is already running for this library")
    from app.services.duplicates import find_duplicates
    job = Job(type=JobType.DUPLICATES, status=JobStatus.PENDING, library_id=library_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    await enqueue(job.id, find_duplicates, library_id, job.id, body.use_size, body.use_duration, body.use_phash)
    return {"message": "Duplicate scan queued"}
```

- [ ] **Step 2: Verify the app imports cleanly**

```bash
cd /home/raslan/transcoder/backend
python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/raslan/transcoder
git add backend/app/api/libraries.py
git commit -m "feat: create Job record for duplicate scans, add in-progress guard"
```

---

### Task 3: Update the Jobs page to label duplicate scans

**Files:**
- Modify: `frontend/src/pages/Jobs.tsx`

Context: `TYPE_LABEL` at the top of Jobs.tsx maps job type strings to display names. Duplicate scan jobs (type `"duplicates"`) will now appear in the jobs list but will show as an empty string without a label entry. Add the label so they render correctly.

- [ ] **Step 1: Add "duplicates" to TYPE_LABEL**

Open `frontend/src/pages/Jobs.tsx`. Find the `TYPE_LABEL` constant:

```typescript
const TYPE_LABEL: Record<string, string> = {
  scan: "Scan",
  check: "Corruption check",
  transcode: "Transcode",
};
```

Replace it with:

```typescript
const TYPE_LABEL: Record<string, string> = {
  scan: "Scan",
  check: "Corruption check",
  transcode: "Transcode",
  duplicates: "Duplicate scan",
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/raslan/transcoder/frontend
npm run build 2>&1 | tail -5
```

Expected: build succeeds (zero type errors).

- [ ] **Step 3: Commit**

```bash
cd /home/raslan/transcoder
git add frontend/src/pages/Jobs.tsx
git commit -m "feat: add Duplicate scan label to Jobs page type map"
```

---

### Task 4: Duplicates page — extract startPolling and add resume-on-mount effect

**Files:**
- Modify: `frontend/src/pages/Duplicates.tsx`

Context: The Duplicates page currently has the polling logic inlined inside `handleScan`. When the user navigates away and back, the component remounts with fresh state — `scanning` is `false`, no poll is running, and there's no way to know a scan is in progress. We need to:
1. Extract the polling logic into a `startPolling(libraryId)` helper so it can be called from two places
2. Refactor `handleScan` to call `startPolling`
3. Add a `useEffect` on `selectedId` that checks `GET /jobs` for a running/pending `"duplicates"` job for the current library; if found, resume the scanning state

The `api.getJobs()` call returns `Job[]` which already has `type`, `library_id`, and `status` fields (the `Job` interface is already imported from `@/lib/api`).

- [ ] **Step 1: Extract startPolling and refactor handleScan**

Open `frontend/src/pages/Duplicates.tsx`. Find the `handleScan` function. Replace it with `startPolling` + the refactored `handleScan`:

```typescript
  const startPolling = (libraryId: number) => {
    stopPolling();
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        stopPolling();
        setScanning(false);
        return;
      }
      try {
        const result = await api.getDuplicates(libraryId);
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
    startPolling(selectedId);
  };
```

- [ ] **Step 2: Add the resume-on-mount useEffect**

Directly after the existing `useEffect` (the one that calls `api.getLibraries()`), add a new `useEffect` that watches `selectedId`:

```typescript
  useEffect(() => {
    if (!selectedId) return;
    api.getJobs().then((jobs) => {
      const active = jobs.find(
        (j) => j.type === "duplicates" && j.library_id === selectedId &&
               (j.status === "running" || j.status === "pending")
      );
      if (!active) return;
      setScanning(true);
      startPolling(selectedId);
    }).catch(() => {});
  }, [selectedId]);
```

- [ ] **Step 3: Verify TypeScript compiles with zero errors**

```bash
cd /home/raslan/transcoder/frontend
npm run build 2>&1 | tail -5
```

Expected: build completes with zero errors.

- [ ] **Step 4: Commit**

```bash
cd /home/raslan/transcoder
git add frontend/src/pages/Duplicates.tsx
git commit -m "feat: resume duplicate scan polling on page remount"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Rebuild and start**

```bash
cd /home/raslan/transcoder
docker compose up --build
```

- [ ] **Step 2: Start a duplicate scan, then navigate away**

Open http://localhost:7899 → Duplicates page → click "Scan for Duplicates". While the spinner is showing, click to a different page (e.g. Libraries). Navigate back to Duplicates.

Expected: spinner is still showing (scanning state restored from the active job).

- [ ] **Step 3: Verify the scan appears on the Jobs page**

While a scan is running, navigate to the Jobs page. Expected: a row with label "Duplicate scan" in the active jobs section.

- [ ] **Step 4: Let scan complete, navigate away, navigate back**

After scan finishes (results appear), navigate away and back. Expected: results are NOT restored (correct — results come from the in-memory cache, which the page resets on remount; only the scanning *state* is resumed for in-progress scans).

- [ ] **Step 5: Start a scan, immediately navigate away, navigate back, then away again before it completes**

Verify: each time you return while the job is running, the spinner resumes. Once done, results appear immediately on the next remount because `getDuplicates` returns 200.
