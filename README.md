# Parallax

A self-hosted video and image library manager with transcoding, AI scanning, duplicate detection, and media identification. Runs in Docker, accessible from any browser.

## Features

### Videos
- **Library management** — scan video folders; browse by status, resolution, bitrate, duration; split into sub-libraries; libraries auto-rescan when files change on disk
- **Transcoding** — re-encode with ffmpeg using hardware acceleration (NVIDIA NVENC, Intel/AMD VA-API); source-aware codec selection; preserves originals and tracks space savings
- **Compression** — dedicated Compress page to re-encode library files to H.264, HEVC, or AV1 with a CRF slider and live estimated savings; select files by codec (e.g. "non-HEVC" shortcut); cancelable bulk job with per-file progress
- **Duplicate detection** — find duplicates by size, duration, and perceptual hash; configurable similarity threshold and first-frame/all-frames comparison mode
- **Cleanup** — filter and bulk-delete by duration, resolution, FPS, date, filename (exact or fuzzy), CLIP semantic match, or content detections; all filters stack with invert/exclude support
- **Identify & Rename** — search TMDB to identify a folder of badly-named files, match them to episodes via drag-and-drop, and apply Plex/Jellyfin-compatible renames with automatic folder restructuring
- **Subtitles** — scan a folder for missing subtitle files; bulk-download best matches or open a Plex-style search dialog; Whisper local speech-to-text generates SRT files from audio with no API key; multiple subtitle tracks shown in the Plyr player with a language picker; powered by OpenSubtitles.org (200 downloads/day free)

### Images
- **Library management** — scan image folders with automatic thumbnail generation; browse and filter your collection; libraries auto-rescan when files change on disk
- **Duplicate detection** — find duplicate images by perceptual hash with configurable similarity threshold
- **Semantic search** — CLIP-powered natural language search across your entire image library
- **Content review** — filter by semantic similarity and/or content detections; bulk quarantine flagged images; restore or permanently delete from quarantine

### AI
- **CLIP models** — ONNX vision/text encoders for semantic search across both images and videos; multiple model sizes available
- **Content detection** — ONNX-based content detection models; configurable confidence threshold and batch size
- **Whisper** — faster-whisper speech-to-text for local subtitle generation; five model sizes (tiny → large-v3); auto-detects spoken language
- **GPU-accelerated** — CUDA (NVIDIA) and ROCm (AMD) ONNX backends; all AI inference isolated in worker subprocesses — VRAM fully freed after 2 minutes idle; batch size tunable per your hardware

### General
- **Job queue** — background jobs with live progress, phase labels, logs, and cancellation
- **Library delete safety** — when deleting a library that has `_originals/` or `_quarantine/` leftovers, prompts to delete them, review them, or keep them on disk
- **Three themes** — violet (Deep Space), cyan (Modern HUD), amber (Mission Control)

---

## Windows

Parallax runs on Windows via [Docker Desktop](https://www.docker.com/products/docker-desktop/). There is no separate installer — Docker handles the runtime environment.

**All users:** Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) and make sure it is running before continuing. WSL 2 backend is required (the default).

**NVIDIA GPU users:** A recent Game Ready or Studio driver (521+) is all you need — CUDA support for Docker is included in the driver automatically via WSL 2. No separate CUDA toolkit or NVIDIA Container Toolkit install is required on Windows. Use the `latest-cuda` image tag.

**AMD GPU users:** AMD ROCm is not supported under WSL 2 / Docker Desktop on Windows. Use the `latest` (CPU) image tag instead. GPU-accelerated transcoding via hardware video encoders is not available on this path.

Once Docker Desktop is running, follow the [Docker Compose](#docker-compose-recommended) instructions below with the image tag for your hardware. Everything else — the compose file, volume mounts, port — is identical to Linux.

---

## Deployment

Pre-built images are published to the GitHub Container Registry on every release. Pick the tag for your hardware:

| Tag | Hardware |
|-----|----------|
| `ghcr.io/raslan/parallax:latest` | CPU only (no GPU inference) |
| `ghcr.io/raslan/parallax:latest-cuda` | NVIDIA GPU — ONNX CUDA + NVENC |
| `ghcr.io/raslan/parallax:latest-rocm` | AMD GPU — ONNX ROCm + VA-API |

On each release, three images are built and pushed with version tags:

| Image | Tags (example: v1.2.0) |
|-------|------------------------|
| CPU | `latest`, `1.2.0`, `1.2` |
| NVIDIA CUDA | `latest-cuda`, `1.2.0-cuda`, `1.2-cuda` |
| AMD ROCm | `latest-rocm`, `1.2.0-rocm`, `1.2-rocm` |

Pin to a specific release by replacing `latest` with a version tag, e.g. `1.2-cuda` to track all patch releases on 1.2 with CUDA support.

---

### Docker Compose (recommended)

Save this as `docker-compose.yml`, create a `data/` folder alongside it, then run `docker compose up -d`.

**NVIDIA:**
```yaml
services:
  parallax:
    image: ghcr.io/raslan/parallax:latest-cuda
    container_name: parallax
    ports:
      - "7899:7899"
    volumes:
      - ./data:/app/data       # database, thumbnails, keyframes, model cache
      - /mnt/media:/media      # your media — add as many mounts as needed
    environment:
      - DATA_DIR=/app/data
      - HF_HOME=/app/data/hf-cache
    user: "1000:1000"          # match your host UID:GID — run `id` to check
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu, video]
```

**AMD (ROCm):**
```yaml
services:
  parallax:
    image: ghcr.io/raslan/parallax:latest-rocm
    container_name: parallax
    ports:
      - "7899:7899"
    volumes:
      - ./data:/app/data
      - /mnt/media:/media
    environment:
      - DATA_DIR=/app/data
      - HF_HOME=/app/data/hf-cache
    user: "1000:1000"
    restart: unless-stopped
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - video
```

**CPU:**
```yaml
services:
  parallax:
    image: ghcr.io/raslan/parallax:latest
    container_name: parallax
    ports:
      - "7899:7899"
    volumes:
      - ./data:/app/data
      - /mnt/media:/media
    environment:
      - DATA_DIR=/app/data
      - HF_HOME=/app/data/hf-cache
    user: "1000:1000"
    restart: unless-stopped
```

---

### Docker Run

**CPU:**
```bash
docker run -d \
  --name parallax \
  -p 7899:7899 \
  -v ./data:/app/data \
  -v /mnt/media:/media \
  -e DATA_DIR=/app/data \
  -e HF_HOME=/app/data/hf-cache \
  --user 1000:1000 \
  --restart unless-stopped \
  ghcr.io/raslan/parallax:latest
```

**NVIDIA:**
```bash
docker run -d \
  --name parallax \
  -p 7899:7899 \
  -v ./data:/app/data \
  -v /mnt/media:/media \
  -e DATA_DIR=/app/data \
  -e HF_HOME=/app/data/hf-cache \
  --user 1000:1000 \
  --gpus all \
  --restart unless-stopped \
  ghcr.io/raslan/parallax:latest-cuda
```

**AMD (ROCm):**
```bash
docker run -d \
  --name parallax \
  -p 7899:7899 \
  -v ./data:/app/data \
  -v /mnt/media:/media \
  -e DATA_DIR=/app/data \
  -e HF_HOME=/app/data/hf-cache \
  --user 1000:1000 \
  --device /dev/dri:/dev/dri \
  --group-add video \
  --restart unless-stopped \
  ghcr.io/raslan/parallax:latest-rocm
```

---

## Configuration

### Volumes

| Mount | Purpose |
|-------|---------|
| `/app/data` | Database, thumbnails, keyframes, downloaded AI models |
| `/media` (or any path) | Your media folders — mount as many as needed |

### Port

Default is `7899`. Override with the `PORT` environment variable:

```yaml
environment:
  - PORT=8080
ports:
  - "8080:8080"
```

### User

Set `--user UID:GID` (or `user:` in Compose) to match your host user so files created by the container are owned correctly. Find your UID/GID with `id`.

### NVIDIA prerequisites

Requires [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on the host before running a CUDA build.

---

## First run

1. Open [http://localhost:7899](http://localhost:7899)
2. Go to **Settings → AI Models** to download CLIP and content detection models (required for AI features on both videos and images)
3. Go to **Settings → Keys & Accounts** and add a free [TMDB API key](https://www.themoviedb.org/settings/api) to enable the Identify feature, and your [OpenSubtitles.org](https://www.opensubtitles.org) credentials to enable subtitle downloads
4. Add a library — **Videos → Add Library** for a video folder, **Images → Add Library** for an image folder
5. Run a scan; for video libraries the AI scan extracts keyframes then runs CLIP + content detection in batches; for image libraries it generates thumbnails and runs the same AI pipeline

---

## Build from source

If you want to build your own image (e.g. to run unreleased code):

```bash
git clone https://github.com/raslan/parallax.git
cd parallax

# CPU
docker build -t parallax:cpu .

# NVIDIA CUDA
docker build --build-arg RUNTIME=cuda -t parallax:cuda .

# AMD ROCm
docker build --build-arg RUNTIME=rocm -t parallax:rocm .
```

Then substitute `parallax:cuda` (etc.) for the `ghcr.io/...` image in the examples above.

> When iterating locally, always pass `--build` to `docker compose up` — a plain restart won't pick up code changes.

---

## Stack

- **Backend** — Python 3.12, FastAPI, SQLAlchemy, SQLite, ffmpeg, subliminal
- **Frontend** — React, TypeScript, Vite, shadcn/ui, Tailwind CSS
- **Container** — multi-stage Docker build (Node → Python), single port, three runtime targets
