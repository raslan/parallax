# Duplicate Criteria Selection Design Spec

## Overview

Make the duplicate detection pipeline configurable per-run. Users can toggle which of the three matching criteria are active: exact size, duration (±1s), and visual fingerprint (pHash). At least one criterion must be active. All default to on, preserving current behaviour.

---

## 1. Backend

### `find_duplicates` signature

```python
def find_duplicates(
    library_id: int,
    use_size: bool = True,
    use_duration: bool = True,
    use_phash: bool = True,
) -> list[DuplicateGroup]:
```

### Algorithm

**Candidate pool:**
- `use_size=True`: query only files whose exact byte size appears more than once in the library (current behaviour).
- `use_size=False`: query all files in the library.

**Duration stage (within each size group, or globally if size off):**
- `use_duration=True`: cluster by ±1s duration (current behaviour).
- `use_duration=False`: skip — pass the whole group forward as one cluster.

**pHash stage (within each duration cluster):**
- `use_phash=True`: cluster by visual fingerprint, Hamming distance ≤ 10 (current behaviour).
- `use_phash=False`: skip — every group that reaches this stage becomes a `DuplicateGroup` directly.

Any group with fewer than 2 files after all active stages is discarded (not a duplicate).

### POST endpoint body

`POST /libraries/{id}/find-duplicates` accepts an optional JSON body:

```json
{ "use_size": true, "use_duration": true, "use_phash": true }
```

All fields optional, defaulting to `true`. A Pydantic schema `DuplicateCriteriaRequest` handles this.

---

## 2. Frontend

### Criteria panel

Rendered above the "Find Duplicates" button on the Duplicates page, using the existing `SectionHeader` component:

```
MATCH CRITERIA
☑ Exact size   ☑ Duration (±1s)   ☑ Visual (pHash)

                              [Find Duplicates]
```

- Three checkboxes in a single row, all checked by default.
- "Find Duplicates" button is disabled when all three are unchecked.
- State is local (`useState`) — not persisted, resets on page reload.

### API call

`api.findDuplicates(libraryId, criteria)` passes `{ use_size, use_duration, use_phash }` in the POST body. The `DuplicateCriteria` interface is added to `api.ts`.

### Unchanged

Results display, group rendering, keep/delete logic, delete-all flow — no changes.

---

## 3. Files Changed

| File | Change |
|---|---|
| `backend/app/services/duplicates.py` | Add `use_size`, `use_duration`, `use_phash` params; adapt pipeline |
| `backend/app/api/libraries.py` | Add `DuplicateCriteriaRequest` schema; pass criteria to `find_duplicates` |
| `frontend/src/lib/api.ts` | Add `DuplicateCriteria` interface; update `findDuplicates` call |
| `frontend/src/pages/Duplicates.tsx` | Add criteria state + checkbox panel above Find Duplicates button |

---

## 4. Non-Goals

- No persistence of criteria between sessions
- No tolerance adjustment
- No changes to result display, keep/delete logic, or any other page
