# Backend — CLAUDE.md

See the root `CLAUDE.md` for project overview, commit conventions, and release workflow.

## Structure

```
backend/app/
  api/          # FastAPI routers (one file per resource)
  models/       # SQLAlchemy ORM models
  services/     # Business logic (scanner, corruption, transcoder, encoder)
  schemas.py    # Pydantic request/response models
  database.py   # Engine, SessionLocal, init_db (includes migrations)
  queue.py      # Asyncio job queue with concurrency control
  config.py     # Env-var config (DATA_DIR, THUMBNAILS_DIR, etc.)
  main.py       # FastAPI app, lifespan, router registration
```

## Conventions

- **SQLAlchemy 2.0 style**: use `Mapped` / `mapped_column`, not the legacy `Column()` syntax.
- **Schema changes**: add `ALTER TABLE ... ADD COLUMN` guards in `init_db()` in `database.py`. Never create a migration file or use Alembic.
- **Background jobs**: always go through `app/queue.py → enqueue()`. Never run blocking work directly in a FastAPI endpoint.
- **Job lifecycle**: create a `Job` record with `status=PENDING` in the API endpoint before calling `enqueue()`. Pass the `job_id` to the worker so it can mark itself `RUNNING` when it actually starts.
- **Cancellation**: use `arm_cancel` / `should_cancel` / `clear_cancel` from `services/common.py`. Check `should_cancel` inside long ffmpeg loops.
- **Shared utilities**: `now()` and `log()` live in `services/common.py`. Use them everywhere — don't inline `datetime.now()` or raw `db.add(JobLog(...))`.
- **HTTP errors**: raise `HTTPException` with a plain English detail string. No custom exception classes.
- **409 Conflict**: used when a job of the same type is already running for a library/file. Check with `active_job_exists()` from `api/utils.py`.

## ffmpeg / ffprobe notes

- Corruption check: `ffmpeg -v error -nostats -i <file> -f null -` — stderr lines starting with `[null ` are muxer noise, not errors; filter them out.
- Transcoding: always use `-progress pipe:1 -nostats` and read stdout line-by-line for `out_time_ms=` to drive progress updates.
- Probe: `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_type,duration,bit_rate -show_entries format=size,duration,bit_rate -of json`.
- Encoder selection: `encoder_for_codec(source_codec)` in `services/encoder.py` — HEVC/AV1/VP9 sources get HEVC output; everything else gets H.264. Hardware encoders (nvenc) are preferred when available.
