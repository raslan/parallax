# Changelog

All notable changes to this project will be documented in this file.
Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) spec.

## [Unreleased]

### Bug Fixes

- Re-encode audio to AAC when converting WMV/AVI/WebM to MKV
- Add migration for files.extension column
- Add extension to browse sort keys in libraries endpoint
- Use transaction rollback pattern in db fixture, add pytest-mock
- Remove premature image model import from init_db
- Thread-safe lazy init and narrow EXIF exception in image_analyzer
- Batched count query and per-library scan lock in image_libraries API
- Address post-review issues in image library implementation
- Multi-runtime Docker builds, cascade image library delete, UI consistency
- Pass RUNTIME build arg via env var in docker-compose
- Correct nvidia/cuda base image tag to 12.9.2-cudnn-runtime-ubuntu22.04
- Set DEBIAN_FRONTEND=noninteractive to suppress tzdata prompt in gpu stages
- Install libcublas-12-9 in cuda stage (not included in runtime image)
- Install onnxruntime variant after requirements.txt to prevent inappropriate_model overwriting gpu build
- Force GPU providers for inappropriate content model session, consolidate provider list to constant
- Use cuda 12.4 base image — driver 550.x doesn't support 12.9 forward compat on consumer GPUs
- Cache inappropriate_model session per scan, release all GPU sessions when scan completes
- Add sentencepiece dependency required by SiglipTokenizer
- Download vision_model.onnx (vision-only encoder) instead of model.onnx (full cross-modal)
- Correct inappropriate content model key (class not label), use SigLIP pooler_output for embeddings
- Switch from SigLIP to CLIP ViT-B/32 for image search embeddings
- Update UI label from SigLIP to CLIP
- Settings PATCH — optional fields, targeted release_sessions, 422 for undownloaded model
- Image_analyzer — return session inside lock, atomic release, guard INAPPROPRIATE_MODELS lookup
- Monkeypatch MODELS_DIR directly to avoid app.database import caching in tests
- Cache NudeDetector objects directly so 640m gets correct 640x640 input size
- Set HF_HOME to data volume so HuggingFace cache is writable as non-root user
- Correct inappropriate content model 640m download URL and add content validation

### Chores

- Add test infrastructure and image ML dependencies
- Gitignore test_images.db
- Merge feature/scan-batching into main

### Documentation

- Add image library management design spec
- Update changelog
- Replace inappropriate content model name with 'inappropriate content' in docs

### Features

- Multi-select batch transcoding in Files view
- Add sort by extension in Files view
- Default RUNTIME=cuda in docker-compose for nvidia GPU
- Add ImageLibrary DB model
- Add Image and ImageDetection DB models
- Add IMAGE_SCAN job type and image Pydantic schemas
- Add image analyzer service (inappropriate content model + SigLIP ONNX)
- Add image analyzer service (inappropriate content model + SigLIP ONNX)
- Add image scanner service
- Add image scanner service
- Add image duplicates service
- Add image libraries and images API routers
- Register image API routers and add IMAGE_SCAN job label
- Restructure sidebar into VIDEOS / IMAGES sections
- Add image API types and client functions
- Add image section pages and wire routes
- Content review — enable toggles, AND/OR combine mode, invert detection
- Add invert option to CLIP semantic search
- Click-to-preview with always-visible checkbox on image cards
- Add model registry and download service
- Add MODEL_DOWNLOAD job type and models API router
- Add clip_model and inappropriate_model_model to settings API
- Per-model session caching in image_analyzer — dict keyed by model_id
- Wire clip_model and inappropriate_model_model settings into scanner and search
- Add ModelInfo type and modelsApi to frontend api.ts, update settings types
- AI Models card in Settings with download/delete/activate per model
- Min_score slider in ContentReview semantic search panel
- Rename siglip_embedding→clip_embedding, add reset+rescan, run_siglip→run_clip
- Image library — CLIP/inappropriate content model search, content review, quarantine, model management
- Show inline download progress in Settings AI Models card
- Collapsible sidebar sections with localStorage persistence
- Add CLIP ViT-L/14@336px model option
- Replace native video element with Plyr player
- CLIP semantic search + inappropriate content model detection for video files
- Scan batching, persistent keyframes, AI filter improvements
- PHash duplicate detection, filename filter, and scan improvements

### Refactor

- Make play-on-click the default, gate multi-select behind Transcode toggle
- Derive onnxruntime package from RUNTIME arg, no user input needed

## [0.10.4] - 2026-05-19

### Bug Fixes

- Move unmatched files to Unmatched/ instead of leaving them in place
- Save all settings to DB before runtime update so TMDB key persists

### Chores

- **main:** Release 0.10.4
- **main:** Release 0.10.4

## [0.10.3] - 2026-05-19

### Bug Fixes

- Scan video files recursively to support pre-structured season folders

### Chores

- **main:** Release 0.10.3
- **main:** Release 0.10.3

## [0.10.2] - 2026-05-19

### Bug Fixes

- Remove stray closing brace from index.css

### Chores

- **main:** Release 0.10.2
- **main:** Release 0.10.2

## [0.10.1] - 2026-05-19

### Bug Fixes

- Remove Rose / Infrared theme

### Chores

- **main:** Release 0.10.1
- **main:** Release 0.10.1

### Ci

- Inline docker publish into release-please workflow

## [0.10.0] - 2026-05-19

### Chores

- **main:** Release 0.10.0
- **main:** Release 0.10.0

### Features

- Add Rose / Infrared theme option

### Ci

- Trigger docker publish on release published instead of tag push

## [0.9.0] - 2026-05-19

### Bug Fixes

- Enable cross-season drag-and-drop in file matcher

### Chores

- Add release-please for automated semantic versioning
- Ignore CLAUDE.md in all subdirectories
- Ignore .worktrees directory
- Add requests dependency
- Add dnd-kit dependencies
- Remove parallel season fetching, use search response data only
- **main:** Release 0.9.0
- **main:** Release 0.9.0

### Documentation

- Add README

### Features

- Add TMDB API key to settings
- TMDB service with search and season endpoints
- Renamer service with Plex/Jellyfin filename generation
- Identify API router with search, preview, and apply endpoints
- Identify wizard page, FileMatcher component, and sidebar navigation
- Extract DirPicker to shared component, use in Identify page
- Poster grid for search results with season count for TV shows
- Auto-load episodes on show select, season input triggers reload
- Load all seasons/episodes at once, files sorted into season subfolders
- Thumbnails and per-season accordions in file matcher

## [0.8.1] - 2026-05-19

### Chores

- Add CLAUDE.md and docs/ to .gitignore
- Add GHCR publish workflow on version tags

### Documentation

- Update changelog for v0.8.0

## [0.8.0] - 2026-05-19

### Documentation

- Update changelog for v0.7.0

### Features

- Cleanup sort, sub-library split, auto-scan on library creation

## [0.7.0] - 2026-05-19

### Bug Fixes

- Restore correctly removes transcoded file when extension changed
- Restored files reset to unknown, not corrupt
- Remove redundant Content-Type header in findDuplicates
- Guard against all-criteria-false on backend; add poll timeout on frontend
- Stop active poll when switching libraries on Duplicates page
- Track total_files and progress during duplicate scan
- Track progress per pHash file extraction, not per size group
- Persist criteria to localStorage, suppress ready-state flicker on remount
- Sort by duration before clustering so grouping is deterministic
- Set processed_files on completion; widen duration tolerance to ±2s
- Thumbnail no-cache header; add filesystem directory browse endpoint

### Chores

- Ignore .superpowers/ directory

### Documentation

- Add duplicate criteria selection design spec
- Add duplicate criteria selection implementation plan
- Update CLAUDE.md capabilities for v0.7.0
- Add duplicate job records implementation plan

### Features

- Add use_size/use_duration/use_phash params to find_duplicates
- Accept duplicate criteria flags in find-duplicates endpoint
- Add DuplicateCriteria interface and update findDuplicates signature
- Add match criteria checkboxes to Duplicates page
- Add JobType.DUPLICATES and give find_duplicates a job lifecycle
- Create Job record for duplicate scans, add in-progress guard
- Add Duplicate scan label to Jobs page type map
- Resume duplicate scan polling on page remount
- Duplicate scan job records, progress tracking, and criteria selection
- UI improvements — dir picker, remove dashboard, page labels, cleanup

### Remove

- Demo corrupt-library feature
- Delete corruptor.py service file

## [0.6.0] - 2026-05-18

### Bug Fixes

- Add font-mono to bitrate span in Duplicates FilePanel
- Resolve final review issues — FOWT, dead import, label consistency, StatusDot color
- Surface per-file transcode errors in job logs and job.error
- Remux incompatible containers (webm/flv/avi) to mkv on transcode

### Documentation

- Add Parallax rebrand design spec
- Add Parallax rebrand implementation plan
- Update CLAUDE.md and CHANGELOG for Parallax v0.6.0

### Features

- Add three-theme CSS custom property system (violet/cyan/amber)
- Add ThemeProvider with localStorage persistence
- Wire ThemeProvider and update title/favicon to Parallax
- Add ParallaxLogo, SectionHeader, StatPanel, StatusDot components
- Rebrand sidebar — Parallax wordmark and P lettermark logo
- Retrofit Dashboard with Parallax design language
- Add Appearance theme picker to Settings
- Apply Parallax design language to Libraries, Files, Duplicates, Cleanup
- Apply Parallax design language to Jobs and Originals

### Refactor

- Extract shared CSS vars (destructive, radius) from theme blocks

## [0.5.0] - 2026-05-18

### Bug Fixes

- **queue:** Scan and check jobs silently dropped after queue rewrite
- Close DB session early, remove dead code, add ffmpeg timeout in duplicates service
- Stop duplicate scan polling on server errors and before re-scan
- Use useEffect for library loading in Cleanup page
- Avoid filename collision when moving files to _originals/ in cleanup delete

### Chores

- Add script to generate corrupt test videos
- Add imagehash and Pillow for perceptual hashing
- Add one-click corrupt button and improve corruption simulation

### Documentation

- Update changelog for v0.4.0
- Add CLAUDE.md files with project guidelines
- Add duplicate video detection design spec
- Add duplicate detection implementation plan
- Add cleanup page design spec
- Update changelog for v0.5.0

### Features

- Add duplicate detection schemas
- Implement duplicate detection service with pHash pipeline
- Add duplicate detection and deletion endpoints
- Add duplicate detection API types and calls
- Add Duplicates page
- Wire up Duplicates page route and nav item
- Add file_width, file_height, file_fps, file_date columns to files table
- Expand ffprobe call and populate file_width, file_height, file_fps, file_date during scan
- Expose file_width, file_height, file_fps, file_date in FileRead schema
- Add GET and DELETE /libraries/{id}/cleanup endpoints
- Add CleanupParams, VideoFile new fields, cleanup API calls, formatUnixDate
- Add Cleanup page with filter panel and results table
- Wire up Cleanup page route and nav item
- Video playback and grid/list view toggle on all library screens

### Styling

- Normalize column alignment in File model
- Clean up scanner field assignments and file_date logic
- Remove redundant undefined check in formatUnixDate

## [0.4.0] - 2026-05-09

### Bug Fixes

- Prevent duplicate jobs, cancel race condition, and enforce scan-before-check
- Stop jobs when library is deleted, check cancel before slow loops
- Cancellable corruption checks, skip _originals on scan, queue multiple transcodes
- Exclude null muxer lines from corruption detection

### Chores

- Initial project setup with Docker and gitignore
- Add .dockerignore
- Add git-cliff config for changelog generation

### Documentation

- Add initial CHANGELOG.md generated by git-cliff
- Update changelog for v0.3.0

### Features

- **backend:** Phase 1 — FastAPI skeleton with SQLAlchemy models
- **frontend:** Phase 1 — React/Vite/shadcn/Tailwind scaffold
- Phase 3 — corruption scanning with asyncio queue and SSE progress
- Phase 4 — transcode corrupt files with encoder detection and preset picker
- Corruption detail display and richer job progress
- Codec detection, constrained CRF, and job queue overhaul
- Refract branding, violet theme, and dashboard redesign
- Originals management — browse, restore, and delete backups
- File sorting by name, size, duration, and bitrate


