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

| File                      | Purpose                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scanner.py`              | Basic video library scan (metadata + thumbnails)                                                              |
| `video_scanner.py`        | AI video scan: seek-based keyframes, CLIP (3 midpoint frames) + NudeNet (all frames)                          |
| `video_analyzer.py`       | ffmpeg frame extraction helpers: `extract_frames_evenly`, `extract_frames_at`, probe/scale/hwaccel utilities  |
| `phash_scanner.py`        | pHash extraction for duplicate detection: 16 seek-based frames at 256px, called from within `find_duplicates` |
| `image_scanner.py`        | Image library scan: thumbnails, CLIP, content detection                                                       |
| `image_analyzer.py`       | ONNX inference proxy (CLIP + inappropriate content) — manages worker subprocess                               |
| `_image_analyzer_impl.py` | Actual ONNX inference code that runs inside the worker process                                                |
| `whisper_service.py`      | Whisper transcription proxy — manages worker subprocess                                                       |
| `_whisper_impl.py`        | Actual CTranslate2/Whisper inference code inside the worker                                                   |
| `transcoder.py`           | ffmpeg transcoding (in-place, saves originals)                                                                |
| `compressor.py`           | Compress job runner                                                                                           |
| `corruption.py`           | ffprobe-based corruption checks                                                                               |
| `duplicates.py`           | Video duplicate detection (size, duration, pHash); integrates pHash scan phase before comparison              |
| `image_duplicates.py`     | Image duplicate detection (pHash)                                                                             |
| `subtitle_service.py`     | Subtitle scan, multi-provider (subf2m + yts-subs) download dispatch, Whisper transcription job                |
| `subf2m_provider.py`      | subf2m.co scraper — no auth, no key, title/year text search                                                   |
| `ytssubs_provider.py`     | yts-subs.com scraper — no auth, no key, but no title search: requires an IMDB ID (resolved via TMDB)          |
| `stream_cache.py`         | On-demand audio remux for browser playback — see "Stream playback audio compatibility" below                  |
| `downloader.py`           | yt-dlp download job runner; read loop uses `select()` with a 300s stall watchdog — kills the process group and fails the row if no stdout output for that long, so a hung yt-dlp/ffmpeg subprocess can't hold a concurrency slot forever. `last_pct` resets on every new `Destination:` line — yt-dlp emits percent per stream (video, then audio, then merge), each restarting from 0, so the reset avoids progress getting stuck at the previous stream's final %. Concurrency is a `_ResizableSemaphore` (not a plain `asyncio.Semaphore`) so `max_concurrent_downloads` can change live — `set_max_concurrent()` is called from the settings save route, mirroring `queue.update_max_concurrent()` for transcodes. `unique_playlist_dir()` avoids playlist folder collisions — sites with no real playlist title (flat-playlist dump lacks `title`/`uploader`) all fall back to the same generic "playlist" name in `_safe_dirname`; the enqueue route reuses the existing folder only when `playlist_id` matches a prior download (continuation), otherwise numbers a fresh one |
| `fs_watcher.py`           | watchdog-based filesystem watcher — incremental rescans                                                       |
| `encoder.py`              | Codec → encoder selection (NVENC / software fallback)                                                         |
| `model_manager.py`        | AI model download/path management                                                                             |
| `tmdb.py`                 | TMDB API metadata lookup                                                                                      |
| `renamer.py`              | File rename logic                                                                                             |
| `common.py`               | `now()`, `log()`, `arm_cancel`, `should_cancel`, `clear_cancel`                                               |

## Conventions

- **SQLAlchemy 2.0 style**: use `Mapped` / `mapped_column`, not `Column()`.
- **Schema changes**: add `ALTER TABLE ... ADD COLUMN` guards in `init_db()`. Never use Alembic.
- **SQLite FK enforcement is ON** — `PRAGMA foreign_keys=ON` set via engine event listener. Delete children before parents.
- **SQLite WAL + busy_timeout** — `PRAGMA journal_mode=WAL` and `busy_timeout=30000` set on connect (`database.py`). Needed because job workers + SSE pollers hit the DB concurrently from separate threads; without WAL, concurrent writes/reads can throw `database is locked` with zero retry.
- **Background jobs**: always go through `queue.py → enqueue()`. Never block in a FastAPI endpoint.
- **Job lifecycle**: create `Job` with `status=PENDING` in the endpoint, pass `job_id` to worker, worker sets `RUNNING` when it starts.
- **Cancellation**: `arm_cancel` / `should_cancel` / `clear_cancel` from `common.py`. Check `should_cancel` inside long loops and before new DB inserts in scanners.
- **Shared utilities**: `now()` and `log()` from `common.py`. Don't inline `datetime.now()` or raw `JobLog` inserts.
- **HTTP errors**: raise `HTTPException` with plain English detail. No custom exception classes.
- **409 Conflict**: for duplicate active jobs — use `active_job_exists()` from `api/utils.py`.
- **Bulk actions get a dedicated endpoint, not N client-side loop calls** — e.g. `POST /downloads/retry-failed` and `POST /downloads/stop-all` do the whole batch in one request/one DB session server-side, instead of the frontend firing one HTTP call per row. Matters most for downloads: `POST /downloads` re-probes each URL with a `yt-dlp --dump-single-json` subprocess, so looping it client-side over a large failed batch means one subprocess per row for no reason.

## Linting & formatting

Ruff handles both lint and format — no Black/isort/flake8. Config lives in `backend/pyproject.toml`.

```bash
ruff check backend/          # lint
ruff check backend/ --fix    # lint, autofix what's safe to autofix
ruff format backend/         # format
```

Both run automatically on staged `*.py` files via the repo's pre-commit hook (see root `package.json`'s `lint-staged` config).

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

## Live file-change streaming

`GET /files/stream` and `GET /images/stream` (optionally `?library_id=N`) are poll-and-diff SSE endpoints, same shape as `GET /jobs/stream` — each tick computes `COUNT(*) + MAX(id) + MAX(updated_at)` over the relevant table (scoped to one library if `library_id` is given) and pushes only when that signature changes. `File.updated_at`/`ImageFile.updated_at` use SQLAlchemy's `onupdate=func.now()`, so they update automatically on any ORM-level row change — no endpoint has to remember to signal these streams; the signature just reflects current DB state on each 2s tick.

## Subtitle providers

Two independent scrapers, both no-auth/no-key/no-daily-limit:

- **subf2m** (`subf2m_provider.py`) — searches subf2m.co by title/year text directly. Primary provider; used by default in both manual search and bulk download.
- **yts-subs** (`ytssubs_provider.py`) — mirror of the dead yifysubtitles.com. Has no title-search endpoint of its own — subtitles only exist under `/movie-imdb/{imdb_id}`, so `subtitle_service.resolve_imdb_id()` looks the film up via TMDB (`tmdb.get_imdb_id()`) first. **Requires a TMDB API key** — without one it can't be used at all, not even as a fallback.

`search_file()` takes a `provider` param ("subf2m" default, or "ytssubs") for manual per-file search — `SubtitleSearchDialog.tsx` exposes this as a source tab. `download_one()` dispatches on the `provider` field already carried by each candidate result, so downloading a specific pick just routes to whichever provider found it.

`run_download_job()` (bulk folder download) always tries subf2m first per missing language; if a TMDB key is configured (`get_setting(db, "tmdb_api_key")`), it falls back to yts-subs for whatever languages subf2m didn't find. No TMDB key → yts-subs step is skipped silently, subf2m-only behavior unchanged.

## Stream playback audio compatibility

Browsers can't decode AC3/DTS/TrueHD etc. (common in movie rips) in an HTML5 `<video>` — video plays with no audio. `stream_cache.py` fixes this with an on-demand remux, and `VideoPlayerModal.tsx` (the single shared player used across Files, Duplicates, Cleanup, Compress, Subtitles) drives it via a prepare-then-poll flow so every caller gets a progress indicator for free instead of the play button silently hanging:

- `POST /stream/prepare {path}` (`api/stream.py`) → `stream_cache.start_prepare()`: probes audio codec with ffprobe; if already web-safe (aac/mp3/opus/vorbis/flac), returns `{"status": "ready"}` immediately, no remux. Otherwise starts a background `threading.Thread` running ffmpeg (video stream-copied, audio re-encoded to AAC stereo, explicit `-map 0:v:0 -map 0:a:0` so a stray subtitle/attachment stream from the source doesn't break the mp4 muxer) and returns `{"status": "running", "progress": 0}`. Idempotent — safe to call repeatedly.
- `GET /stream/prepare-status?path=` → `stream_cache.needs_prepare()`: non-blocking poll, same response shape, `progress` parsed from ffmpeg's `-progress pipe:1` output against the file's ffprobed duration (mirrors `transcoder.py`'s progress-parsing pattern, including writing ffmpeg stderr to a tempfile rather than a pipe to avoid a full-buffer deadlock).
- `GET /files/{id}/stream` and `GET /subtitles/stream` still call `stream_cache.get_stream_path()` directly as a blocking safety net for any caller that skips the prepare step — it waits on the same in-flight remux (or starts one) rather than racing a duplicate.
- Remuxed output lands in a **single-slot** cache at `DATA_DIR/stream-cache/current.mp4` — only one remuxed file is ever kept on disk, evicted and rebuilt when a different source is requested, and swept after an hour of no plays (checked opportunistically per request, no background timer). A module-level lock serializes start/eviction decisions. This is a convenience cache for occasional problem files, not a general transcode cache — don't extend it to hold more than one file without revisiting the design.
- If the remux itself fails (bad source stream, ffmpeg error), status becomes `{"status": "error", "error": "..."}` and the frontend falls back to playing the original file (audio may still be silent) rather than blocking playback entirely.

## ffmpeg / ffprobe notes

- **Corruption**: `ffmpeg -v error -nostats -i <file> -f null -` — filter stderr lines starting with `[null ` (muxer noise).
- **Transcoding**: `-progress pipe:1 -nostats`, read stdout line-by-line for `out_time_ms=`.
- **Probe**: `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_type,duration,bit_rate,width,height,r_frame_rate -show_entries format=size,duration,bit_rate,tags -of json`.
- **Encoder selection**: `encoder_for_codec(source_codec)` in `encoder.py` — HEVC/AV1/VP9 → HEVC out; everything else → H.264. NVENC preferred when available.
- **Temp file naming**: transcoder uses `base + ".transcoding" + ext` for in-progress output.

## Testing

Tests in `backend/tests/` — cannot run in the dev environment. Requires writable `DATA_DIR` and ML packages only present in the Docker image.
