# Backend — CLAUDE.md

See the root `CLAUDE.md` for project overview, commit conventions, and release workflow.

**Keep this file up to date** when adding services, API routes, or changing architectural patterns.

## Structure

```
backend/app/
  api/              # FastAPI routers (one file per resource)
  models/           # SQLAlchemy ORM models
  services/         # Business logic
  schemas.py        # Pydantic request/response models
  database.py       # Engine, SessionLocal, init_db (includes migrations)
  queue.py          # Asyncio job queue with concurrency control
  config.py         # Env-var config (DATA_DIR, THUMBNAILS_DIR, etc.)
  main.py           # FastAPI app, lifespan, router registration
```

### Services

| File | Purpose |
|---|---|
| `scanner.py` | Basic video library scan (metadata + thumbnails) |
| `video_scanner.py` | AI video scan: seek-based keyframes, CLIP (3 midpoint frames) + NudeNet (all frames) |
| `video_analyzer.py` | ffmpeg frame extraction helpers: `extract_frames_evenly`, `extract_frames_at`, probe/scale/hwaccel utilities |
| `phash_scanner.py` | pHash extraction for duplicate detection: 16 seek-based frames at 256px, called from within `find_duplicates` |
| `image_scanner.py` | Image library scan: thumbnails, CLIP, content detection |
| `image_analyzer.py` | ONNX inference proxy (CLIP + inappropriate content) — manages worker subprocess |
| `_image_analyzer_impl.py` | Actual ONNX inference code that runs inside the worker process |
| `whisper_service.py` | Whisper transcription proxy — manages worker subprocess |
| `_whisper_impl.py` | Actual CTranslate2/Whisper inference code inside the worker |
| `transcoder.py` | ffmpeg transcoding (in-place, saves originals) |
| `compressor.py` | Compress job runner |
| `corruption.py` | ffprobe-based corruption checks |
| `duplicates.py` | Video duplicate detection (size, duration, pHash); integrates pHash scan phase before comparison |
| `image_duplicates.py` | Image duplicate detection (pHash) |
| `subtitle_service.py` | Subtitle scan, OpenSubtitles download, Whisper transcription job |
| `downloader.py` | yt-dlp download job runner |
| `fs_watcher.py` | watchdog-based filesystem watcher — incremental rescans |
| `encoder.py` | Codec → encoder selection (NVENC / software fallback) |
| `model_manager.py` | AI model download/path management |
| `tmdb.py` | TMDB API metadata lookup |
| `renamer.py` | File rename logic |
| `common.py` | `now()`, `log()`, `arm_cancel`, `should_cancel`, `clear_cancel` |

## Conventions

- **SQLAlchemy 2.0 style**: use `Mapped` / `mapped_column`, not `Column()`.
- **Schema changes**: add `ALTER TABLE ... ADD COLUMN` guards in `init_db()`. Never use Alembic.
- **SQLite FK enforcement is ON** — `PRAGMA foreign_keys=ON` set via engine event listener. Delete children before parents.
- **Background jobs**: always go through `queue.py → enqueue()`. Never block in a FastAPI endpoint.
- **Job lifecycle**: create `Job` with `status=PENDING` in the endpoint, pass `job_id` to worker, worker sets `RUNNING` when it starts.
- **Cancellation**: `arm_cancel` / `should_cancel` / `clear_cancel` from `common.py`. Check `should_cancel` inside long loops and before new DB inserts in scanners.
- **Shared utilities**: `now()` and `log()` from `common.py`. Don't inline `datetime.now()` or raw `JobLog` inserts.
- **HTTP errors**: raise `HTTPException` with plain English detail. No custom exception classes.
- **409 Conflict**: for duplicate active jobs — use `active_job_exists()` from `api/utils.py`.

## AI inference subprocess isolation

All GPU inference (ONNX and Whisper) runs in an isolated worker subprocess:

- `ProcessPoolExecutor(max_workers=1, mp_context=spawn)` — one persistent worker, fresh CUDA context.
- 120-second idle timer fires `executor.shutdown()` + sets executor to `None` → worker process exits → VRAM freed.
- Idle timer is reset **after** each inference call returns.
- `BrokenExecutor` is caught, executor discarded and recreated, call retried once.
- Explicitly call `release_sessions()` / `release_model()` in the `finally` block of job runners so VRAM is freed immediately on job completion rather than waiting for the idle timer.
- Proxy modules (`image_analyzer.py`, `whisper_service.py`) manage the worker lifecycle. Impl modules (`_image_analyzer_impl.py`, `_whisper_impl.py`) contain model-loading and inference code.

## Scan pipeline — video and image

Both scanners use a **producer-consumer pipeline** to overlap disk I/O with GPU inference:

- A background producer thread pre-loads the next N items (videos or image batches) into a bounded `queue.Queue(maxsize=scan_prefetch)`.
- The main thread (consumer) drains the queue: runs CLIP + NudeNet inference, writes to DB, then loops.
- Producer and consumer use separate hardware: NVDEC/disk I/O vs CUDA compute. The GIL releases during subprocess inference calls, allowing true parallelism.
- `scan_prefetch` setting (default 4, max 20) controls queue depth — higher = more RAM, GPU stays fully fed between items.

**Video scan** (`video_scanner.py`):
- Producer runs `extract_frames_evenly` per video: N individual ffmpeg `-ss` seeks, each returning one frame as rawvideo pipe. No full-video decode.
- Extraction resolution = `max(clip_image_size, nudenet_inference_resolution)` from active model config. `video_keyframes_per_video` default 16, range 4–64.
- Consumer: CLIP on 3 midpoint frames (indices mid-1, mid, mid+1) averaged + L2-normalised; NudeNet on all frames for full coverage. DB commit per video. No frames written to disk.
- **Duplicate scan** (`duplicates.py`): phase 1 extracts pHash via `phash_scanner._extract_phash_frames` for files missing it or with stale frame count (0–50% progress); phase 2 runs size/duration/pHash comparison (50–100%). `phash_frames` count configurable from Duplicates page UI; stored frame count (`len(phash_frames JSON)`) determines whether re-extraction is needed. Hamming distance masked to 64 bits: `bin((a ^ b) & 0xFFFFFFFFFFFFFFFF).count("1")`.

**Image scan** (`image_scanner.py`):
- Producer runs `_load_image_for_scan` per image: single PIL open using `draft()` for JPEG (DCT-domain downsampling, same principle as ffmpeg low-res decode) at `max(clip_res, nudenet_res, 400px)`.
- One file open per image serves metadata extraction, pHash, thumbnail generation, CLIP, and NudeNet — no repeated disk reads.
- Consumer accumulates `scan_batch_size` images, runs CLIP + NudeNet on the batch, commits.
- `scan_batch_size` (default 4) controls inference batch size for images.

Progress runs 0–100% across file/image count.

## Filesystem watcher

`fs_watcher.py` uses watchdog to watch all library paths:

- 30-second debounce — timer resets on each relevant event.
- Filters: skips `_originals/`, `_quarantine/`, `.compressing*`, `.transcoding*`, hidden files.
- On fire: calls `_apply_video_changes` or `_apply_image_changes` which re-checks library existence before any INSERT.
- `unwatch_library()` is called first on library delete to prevent race conditions.

## ffmpeg / ffprobe notes

- **Corruption**: `ffmpeg -v error -nostats -i <file> -f null -` — filter stderr lines starting with `[null ` (muxer noise).
- **Transcoding**: `-progress pipe:1 -nostats`, read stdout line-by-line for `out_time_ms=`.
- **Probe**: `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_type,duration,bit_rate,width,height,r_frame_rate -show_entries format=size,duration,bit_rate,tags -of json`.
- **Encoder selection**: `encoder_for_codec(source_codec)` in `encoder.py` — HEVC/AV1/VP9 → HEVC out; everything else → H.264. NVENC preferred when available.
- **Temp file naming**: transcoder uses `base + ".transcoding" + ext` for in-progress output.

## Testing

Tests in `backend/tests/` — cannot run in the dev environment. Requires writable `DATA_DIR` and ML packages only present in the Docker image.
