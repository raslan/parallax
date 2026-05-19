# Changelog

All notable changes to this project will be documented in this file.
Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) spec.

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

### Documentation

- Update changelog for v0.3.0

### Features

- Phase 4 — transcode corrupt files with encoder detection and preset picker
- Corruption detail display and richer job progress
- Codec detection, constrained CRF, and job queue overhaul
- Refract branding, violet theme, and dashboard redesign
- Originals management — browse, restore, and delete backups
- File sorting by name, size, duration, and bitrate

## [0.3.0] - 2026-05-08

### Documentation

- Add initial CHANGELOG.md generated by git-cliff

### Features

- Phase 3 — corruption scanning with asyncio queue and SSE progress

## [0.2.0] - 2026-05-08

### Chores

- Add .dockerignore
- Add git-cliff config for changelog generation

### Features

- **frontend:** Phase 1 — React/Vite/shadcn/Tailwind scaffold

## [0.1.0] - 2026-05-08

### Chores

- Initial project setup with Docker and gitignore

### Features

- **backend:** Phase 1 — FastAPI skeleton with SQLAlchemy models


