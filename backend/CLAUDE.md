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
| `video_scanner.py` | Full video scan: keyframes, pHash, CLIP, content detection |
| `image_scanner.py` | Image library scan: thumbnails, CLIP, content detection |
| `image_analyzer.py` | ONNX inference proxy (CLIP + inappropriate content) — manages worker subprocess |
| `_image_analyzer_impl.py` | Actual ONNX inference code that runs inside the worker process |
| `whisper_service.py` | Whisper transcription proxy — manages worker subprocess |
| `_whisper_impl.py` | Actual CTranslate2/Whisper inference code inside the worker |
| `transcoder.py` | ffmpeg transcoding (in-place, saves originals) |
| `compressor.py` | Compress job runner |
| `corruption.py` | ffprobe-based corruption checks |
| `duplicates.py` | Video duplicate detection (size, duration, pHash) |
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

## Video scan phases

`scan_video_library` in `video_scanner.py` runs in three phases:

1. **Keyframe extraction + pHash** (0–40%) — ffmpeg extracts N frames per video to `data/video-keyframes/{file_id}/`, computes pHash from first frame and all frames.
2. **CLIP inference** (40–70%) — batched CLIP encoding over all keyframe paths, averaged + L2-normalised per video.
3. **Content detection** (70–99%) — batched inappropriate content inference.

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
