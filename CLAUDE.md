# Parallax — CLAUDE.md

## What this project is

**Parallax** is a self-hosted video transcoding manager. Its primary purpose is to scan media libraries for corrupt video files and repair them by re-encoding with ffmpeg, preserving originals as backups. It runs as a single Docker container and is managed through a browser UI.

Key capabilities:
- Library management: add folders via filesystem dir picker, scan on demand
- Corruption detection: ffprobe-based per-file integrity checks
- Smart transcoding: source-aware codec selection (HEVC/AV1/VP9 → HEVC out; H.264/older → H.264), constrained CRF so output never exceeds source bitrate
- Job queue: configurable concurrency, PENDING/RUNNING/CANCELLED states, live SSE progress; all job types (scan, check, transcode, duplicates) appear on Jobs page
- Originals management: browse, restore, and bulk-delete `_originals/` backups
- File browser: thumbnail grid, per-file corruption details, sort by name/size/duration/bitrate
- Duplicate detection: size, duration (configurable ±N s tolerance), and visual (pHash) matching; results cached in memory per library
- Cleanup: bulk-delete files filtered by duration, FPS, date, or resolution

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, ffmpeg/ffprobe |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui |
| Container | Single Docker image (multi-stage: Node build → Python runtime) |

The app is served at port **7899**. The React SPA is built into `frontend/dist/` and served as static files by FastAPI. All API routes are prefixed `/api`.

## Design system

- **Name**: Parallax
- **Theme**: dark-only, near-black background (`#09090b`)
- **Themes**: three built-in themes selectable via Settings → Appearance:
  - `violet` — **Deep Space** (default): violet accent (`#8b5cf6`)
  - `cyan` — **Modern HUD**: cyan accent
  - `amber` — **Mission Control**: amber accent
- **CSS custom properties**: `--px-accent`, `--px-bg-base`, and related `--px-*` tokens drive all theme colours
- **Design language components**: `SectionHeader`, `StatPanel`, `StatusDot`
- **Logo**: P lettermark SVG with star accent
- **Border radius**: `0.4rem` (tight/sharp)
- **Icon set**: lucide-react
- No light mode.

## Running locally

```bash
docker compose up --build -d   # always use --build; plain restart won't pick up code changes
docker compose logs -f         # tail logs
```

The volume mount in `docker-compose.yml` maps `./data` for the SQLite DB and thumbnails, and your media folder(s) for scanning.

---

## Commit conventions

All commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

### Allowed types

| Type | When to use |
|---|---|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `refactor` | Code change with no behaviour change |
| `perf` | Performance improvement |
| `style` | CSS / visual-only changes |
| `docs` | Documentation only |
| `chore` | Tooling, deps, config |
| `test` | Tests only |

### Rules

- Subject line: imperative mood, no capital, no full stop, ≤72 chars
- Scope is optional but encouraged for large changes: `feat(queue): ...`
- Breaking changes: add `!` after the type or a `BREAKING CHANGE:` footer
- Every commit must be self-contained and buildable
- Co-author line for Claude-assisted commits:
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```

### Examples

```
feat(originals): add bulk delete per library
fix: restore file status to corrupt on pending job cancel
refactor(queue): extract semaphore logic into helper
docs: update changelog for v0.5.0
```

---

## Release workflow

Releases follow [SemVer](https://semver.org/): `vMAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes, no new features
- **MINOR** — new features, backwards-compatible
- **MAJOR** — breaking changes or complete overhauls

### Steps to cut a release

1. Ensure all changes are committed and the build passes.

2. Tag the release:
   ```bash
   git tag v<version>
   ```

3. Regenerate the changelog with [git-cliff](https://git-cliff.org/):
   ```bash
   git cliff --output CHANGELOG.md
   ```

4. Commit the changelog:
   ```bash
   git add CHANGELOG.md
   git commit -m "docs: update changelog for v<version>"
   ```

The `cliff.toml` at the project root controls grouping and formatting. Do not edit `CHANGELOG.md` by hand.

---

## Architecture notes

- **No ORM migrations tool** — schema changes are handled with `ALTER TABLE` guards in `app/database.init_db()`. Add new columns there; SQLite silently ignores the statement if the column exists.
- **Single worker thread per job** — the asyncio queue dispatcher spawns tasks gated by a semaphore; the ThreadPoolExecutor handles actual ffmpeg subprocess calls.
- **SSE for live progress** — `GET /api/jobs/stream` pushes JSON every 500ms while jobs are active and backs off to 10s when idle.
- **`_originals/` dirs** — excluded from library scans via `dirs[:] = [d for d in dirs if d != "_originals"]` in `scanner.py`. Never re-scan or transcode these.
- **Thumbnail cache** — stored at `DATA_DIR/thumbnails/{file_id}.jpg`. Generated during scan; missing thumbnails show a placeholder, not an error.
