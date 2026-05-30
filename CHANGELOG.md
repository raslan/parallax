# Changelog

All notable changes to this project will be documented in this file.
Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) spec.

## [0.13.0](https://github.com/raslan/parallax/compare/v0.12.0...v0.13.0) (2026-05-30)


### Features

* add Windows section to landing page with NVIDIA/CPU compose snippets ([3585c68](https://github.com/raslan/parallax/commit/3585c683f8a8c28f8059aba0875c650e5d7ce14c))


### Bug Fixes

* cap duplicate card max-width so small groups don't stretch too wide ([ffa0b39](https://github.com/raslan/parallax/commit/ffa0b391c18d1eaa009c797a4cbdbbb5ca414e76))
* exclude quarantined images from general list endpoint by default ([d37b140](https://github.com/raslan/parallax/commit/d37b140a6d16e8a02ab7277115055bcb88d55444))
* image duplicate cards flex full-width to match video duplicates ([4ae98b3](https://github.com/raslan/parallax/commit/4ae98b3e84cd9e1c698d17cc89e3f7803e353751))

## [0.12.0](https://github.com/raslan/parallax/compare/v0.11.0...v0.12.0) (2026-05-30)


### Features

* add Tools sidebar section, move Identify, stub Subtitles page ([8ddb72a](https://github.com/raslan/parallax/commit/8ddb72a33bdf4dcde5b67517f952bb76b2b331b0))
* add Vercel landing page with auto-build from README ([7b04311](https://github.com/raslan/parallax/commit/7b043117311a905841d5ee2df68dd024051a151f))
* editorial landing page redesign (Playfair Display, Vercel-style black/white, purple accents) ([7155df0](https://github.com/raslan/parallax/commit/7155df0c22cd739cc96a8b7fbdadae5c93104257))
* favicon, OG meta tags, Twitter card, color refresh, remove nav get-started button ([43d4fca](https://github.com/raslan/parallax/commit/43d4fcaaadf8ef9dca0566fe0d36182cd91cca1b))
* language picker on subtitles page, subtitle settings tab ([8f63f3a](https://github.com/raslan/parallax/commit/8f63f3aa10f6410268944e9707b7c2860e457249))
* subtitle download backend — subliminal service, API router, settings keys ([4cffdae](https://github.com/raslan/parallax/commit/4cffdaeaf7ace29cb06b9e4e4e3e769fcea1eb59))
* subtitle feature — OpenSubtitles.org XMLRPC, manual search dialog, settings refinements ([9210b71](https://github.com/raslan/parallax/commit/9210b71ff809053cc2a2a0c36d2048ca1e11074a))
* subtitles page — scan directory, file tree with status, download job progress ([926d931](https://github.com/raslan/parallax/commit/926d93155791ddb317caceaeddd28666e436ae78))


### Bug Fixes

* copy og-image.png into dist/ so Vercel serves it ([77d1679](https://github.com/raslan/parallax/commit/77d16797eb0d8b3c5d1ed857289a5d0248b3c707))
* eliminate horizontal scroll on mobile in deploy section ([69707ef](https://github.com/raslan/parallax/commit/69707efda1f91d75a47e57bd595faeb62322c85c))
* landing page parser and real logo SVG ([9a7c33a](https://github.com/raslan/parallax/commit/9a7c33aff35363a5aa8981a180b67eaadb842c02))
* make landing page responsive on mobile ([05981e3](https://github.com/raslan/parallax/commit/05981e33bb8c4e01a87a541ed30b102f8ee37a85))

## [0.11.0](https://github.com/raslan/parallax/compare/v0.10.4...v0.11.0) (2026-05-29)


### Features

* add CLIP ViT-L/14@336px model option ([9ea8645](https://github.com/raslan/parallax/commit/9ea8645ccf57c69d16d913037fbcb84257f1d2bf))
* add clip_model and nudenet_model to settings API ([80c469a](https://github.com/raslan/parallax/commit/80c469aa5b1f07d36c0b1b7746828ce98e0ce346))
* add image analyzer service (NudeNet + SigLIP ONNX) ([3a6368d](https://github.com/raslan/parallax/commit/3a6368dc9a5f7af93a0e3e5313b363a96c415a11))
* add image analyzer service (NudeNet + SigLIP ONNX) ([9e2cefd](https://github.com/raslan/parallax/commit/9e2cefd9a151a092da0b787bc0be81a1325a13b5))
* add Image and ImageDetection DB models ([0bcd539](https://github.com/raslan/parallax/commit/0bcd53989f226b0ae5a3f096955b18a8c6863cf2))
* add image API types and client functions ([1c10008](https://github.com/raslan/parallax/commit/1c10008d321c86465f954f071f951f99c4f18b0e))
* add image duplicates service ([1983681](https://github.com/raslan/parallax/commit/198368158fb80f1e06d01f3ebffd2dd38cdc6da5))
* add image libraries and images API routers ([c449b03](https://github.com/raslan/parallax/commit/c449b038482bbbec1a2093df31e5d54bae90a405))
* add image scanner service ([faa61d3](https://github.com/raslan/parallax/commit/faa61d3c61156df3e8547a971067c65f517bd917))
* add image scanner service ([6f86f83](https://github.com/raslan/parallax/commit/6f86f830a971126d3f65f65aafa5b4d1f373d910))
* add image section pages and wire routes ([4d80afb](https://github.com/raslan/parallax/commit/4d80afbaeef5319d3e3af7a303bb53eb9458d757))
* add IMAGE_SCAN job type and image Pydantic schemas ([3743e19](https://github.com/raslan/parallax/commit/3743e19ccc7f79a8a89f897c419ba13d3b4ff030))
* add ImageLibrary DB model ([c7372c9](https://github.com/raslan/parallax/commit/c7372c9d7216ea79d9f842aa18f7203ca99c6aba))
* add invert option to CLIP semantic search ([b2e30ed](https://github.com/raslan/parallax/commit/b2e30ed1c133e6ebaa0d4bc11be223988a5f6393))
* add model registry and download service ([96ff7a2](https://github.com/raslan/parallax/commit/96ff7a2d1dfe9a71e0bf40b5c42bdf1a1b09abe2))
* add MODEL_DOWNLOAD job type and models API router ([61c35d5](https://github.com/raslan/parallax/commit/61c35d5f174976d282520b8e26d28188bc33a87a))
* add ModelInfo type and modelsApi to frontend api.ts, update settings types ([981f189](https://github.com/raslan/parallax/commit/981f18905752e711ebe5bc2dc61b32705370eb0e))
* add sort by extension in Files view ([7f18b75](https://github.com/raslan/parallax/commit/7f18b7580e4b2e44085d8cbb41e0bb936a7794d2))
* AI Models card in Settings with download/delete/activate per model ([f549d9d](https://github.com/raslan/parallax/commit/f549d9db2af1c823f06cf1e7c8d6eb10e5982e9e))
* click-to-preview with always-visible checkbox on image cards ([88e4a2c](https://github.com/raslan/parallax/commit/88e4a2ccbc1e5a057a94b3aa2731640be1c94610))
* CLIP semantic search + NudeNet detection for video files ([05acb91](https://github.com/raslan/parallax/commit/05acb919bd38d8b10950fb32c08410b4bdac36bf))
* collapsible sidebar sections with localStorage persistence ([5c660dd](https://github.com/raslan/parallax/commit/5c660ddd6123d74cd673bcacbd31016d26ec2f4a))
* content review — enable toggles, AND/OR combine mode, invert detection ([ed265b0](https://github.com/raslan/parallax/commit/ed265b044c29d483bcd42a035e5a6b6fd578f230))
* default RUNTIME=cuda in docker-compose for nvidia GPU ([ddff007](https://github.com/raslan/parallax/commit/ddff0073e21eff9be40034c51801ed03f59ae12e))
* image library — CLIP/NudeNet search, content review, quarantine, model management ([9e4c30e](https://github.com/raslan/parallax/commit/9e4c30ea0e41c8e74a488ecc016fbaa1a02980c9))
* min_score slider in ContentReview semantic search panel ([ee419a4](https://github.com/raslan/parallax/commit/ee419a4dfb3f1d88e9c0df3518ddae55df532d12))
* multi-select batch transcoding in Files view ([cadbc2f](https://github.com/raslan/parallax/commit/cadbc2fed2b32cbd0b1312ca9cde01d7e3a0b545))
* per-model session caching in image_analyzer — dict keyed by model_id ([5c0e20f](https://github.com/raslan/parallax/commit/5c0e20f3b1b69e40e191fc288f510b98e94ab68f))
* pHash duplicate detection, filename filter, and scan improvements ([4bab9b5](https://github.com/raslan/parallax/commit/4bab9b59e92972e937131db7aad0ed707a8caca6))
* register image API routers and add IMAGE_SCAN job label ([0c361b2](https://github.com/raslan/parallax/commit/0c361b25e937ccdab4107355b7330beb33609b60))
* rename siglip_embedding→clip_embedding, add reset+rescan, run_siglip→run_clip ([7fd6bf0](https://github.com/raslan/parallax/commit/7fd6bf03804d7a47bf67b0ef7ebbfb2940a91423))
* replace native video element with Plyr player ([a42add7](https://github.com/raslan/parallax/commit/a42add764072ba616e52c3e91662b57ae89e52d4))
* restructure sidebar into VIDEOS / IMAGES sections ([b9d7b1f](https://github.com/raslan/parallax/commit/b9d7b1ff7b0aeea254016540b2dd630309e698a1))
* scan batching, persistent keyframes, AI filter improvements ([f31f073](https://github.com/raslan/parallax/commit/f31f073fcb0bc79f28eb7785713117da189a54ac))
* show inline download progress in Settings AI Models card ([e9a4cea](https://github.com/raslan/parallax/commit/e9a4cea8daec0ef469c3a3de372186acaa307d47))
* wire clip_model and nudenet_model settings into scanner and search ([20f5832](https://github.com/raslan/parallax/commit/20f5832724f351e3a3e20e7f6bfe1fc6f2c521e8))


### Bug Fixes

* add extension to browse sort keys in libraries endpoint ([7e48272](https://github.com/raslan/parallax/commit/7e482724d27064a51bf42e73b081bbf5142f0678))
* add migration for files.extension column ([4a1b5ce](https://github.com/raslan/parallax/commit/4a1b5cee096bf4d40b6b0e42ce0ae2801aaecc66))
* add sentencepiece dependency required by SiglipTokenizer ([a3dea92](https://github.com/raslan/parallax/commit/a3dea9229a6ca5b09350449e508348c3ab19b196))
* address post-review issues in image library implementation ([56153ee](https://github.com/raslan/parallax/commit/56153eefc22fcc278831962f6a5a58fe5cfa3698))
* batched count query and per-library scan lock in image_libraries API ([5800f27](https://github.com/raslan/parallax/commit/5800f27d13733af956d4b0ea4ec2e16892d47370))
* cache NudeDetector objects directly so 640m gets correct 640x640 input size ([5ed827a](https://github.com/raslan/parallax/commit/5ed827aface7189c77d775d270b953bffe37c35d))
* cache nudenet session per scan, release all GPU sessions when scan completes ([5a85483](https://github.com/raslan/parallax/commit/5a85483f031feb4ed756cf68a86f28f24e9d4fa5))
* correct NudeNet 640m download URL and add content validation ([dde99e1](https://github.com/raslan/parallax/commit/dde99e184a449df05e80893b21db7ced3b0fc51f))
* correct NudeNet key (class not label), use SigLIP pooler_output for embeddings ([4dec8fd](https://github.com/raslan/parallax/commit/4dec8fd36c352ccdb576333aadcfaa60cb215da0))
* correct nvidia/cuda base image tag to 12.9.2-cudnn-runtime-ubuntu22.04 ([78a0830](https://github.com/raslan/parallax/commit/78a0830e6d39df8e2206bd907b43877cf66bd6b0))
* download vision_model.onnx (vision-only encoder) instead of model.onnx (full cross-modal) ([c53de78](https://github.com/raslan/parallax/commit/c53de784472bdcdf43c06d9296812740eed09db7))
* force GPU providers for NudeNet session, consolidate provider list to constant ([4cd07d7](https://github.com/raslan/parallax/commit/4cd07d746c6ee87c311f6b725b874d8111342567))
* image_analyzer — return session inside lock, atomic release, guard NUDENET_MODELS lookup ([d30f9ba](https://github.com/raslan/parallax/commit/d30f9baa5daec2ca13dd1456b4417fbb5a4c5f87))
* install libcublas-12-9 in cuda stage (not included in runtime image) ([027e181](https://github.com/raslan/parallax/commit/027e1811760f8b8b1eb06c2cfdee4c798c56be50))
* install onnxruntime variant after requirements.txt to prevent nudenet overwriting gpu build ([3e9a98e](https://github.com/raslan/parallax/commit/3e9a98e37008e0351254563af4500e7ac653f852))
* monkeypatch MODELS_DIR directly to avoid app.database import caching in tests ([2b4a305](https://github.com/raslan/parallax/commit/2b4a305e132efb2fc16748e0fc703fce6dac9e5b))
* multi-runtime Docker builds, cascade image library delete, UI consistency ([ae3d060](https://github.com/raslan/parallax/commit/ae3d06038a1fe983353013cae41e74d034801904))
* pass RUNTIME build arg via env var in docker-compose ([5fcd992](https://github.com/raslan/parallax/commit/5fcd992c08054f2382aa86b85017caf80b49a131))
* re-encode audio to AAC when converting WMV/AVI/WebM to MKV ([68abfb3](https://github.com/raslan/parallax/commit/68abfb3671090236a3c223cf7f87791bdde161f0))
* remove premature image model import from init_db ([742e017](https://github.com/raslan/parallax/commit/742e0176611cd49f546d5ff07613653191be1c29))
* set DEBIAN_FRONTEND=noninteractive to suppress tzdata prompt in gpu stages ([3f64745](https://github.com/raslan/parallax/commit/3f64745a2975ae24725dedaf52f7e5361a1d4487))
* set HF_HOME to data volume so HuggingFace cache is writable as non-root user ([c8ea10f](https://github.com/raslan/parallax/commit/c8ea10f069f5697cbd9769517d294b32259d3437))
* settings PATCH — optional fields, targeted release_sessions, 422 for undownloaded model ([8f7c778](https://github.com/raslan/parallax/commit/8f7c778ab4bbca183ce2854b02029d9e4a451f22))
* switch from SigLIP to CLIP ViT-B/32 for image search embeddings ([07e5f81](https://github.com/raslan/parallax/commit/07e5f819fa03a4c96fe9dcb2aadd66f2490f52dd))
* thread-safe lazy init and narrow EXIF exception in image_analyzer ([121fff8](https://github.com/raslan/parallax/commit/121fff87f60824d95e15ab8cb1a07ac91ad02154))
* update UI label from SigLIP to CLIP ([482236b](https://github.com/raslan/parallax/commit/482236b8c0c3572670de833c4b9d487a5535d944))
* use cuda 12.4 base image — driver 550.x doesn't support 12.9 forward compat on consumer GPUs ([4b8e8a6](https://github.com/raslan/parallax/commit/4b8e8a6080ce06ddcee02e5694df3eaff2d038a7))
* use transaction rollback pattern in db fixture, add pytest-mock ([75cf4ec](https://github.com/raslan/parallax/commit/75cf4ecf1b49c40342ff34c3c7468c382297de44))

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
