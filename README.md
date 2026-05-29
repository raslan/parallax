# Parallax

A self-hosted video and image library manager with transcoding, AI scanning, duplicate detection, and media identification. Runs in Docker, accessible from any browser.

## Features

- **Library management** — scan folders of video or image files; browse by status; split into sub-libraries
- **Transcoding** — re-encode files using ffmpeg with hardware acceleration (NVIDIA NVENC, Intel/AMD VA-API); preserves originals and tracks savings
- **Duplicate detection** — find duplicate files by size, duration, and perceptual hash with configurable similarity threshold and first-frame/all-frames comparison mode
- **Cleanup** — filter and bulk-delete video files by duration, resolution, FPS, date, filename (exact or fuzzy), CLIP semantic match, or content detections; all filters stack and support invert/exclude mode
- **Image library** — scan image folders with thumbnail generation, pHash deduplication, CLIP semantic search, and content detection; quarantine and restore workflow
- **AI scanning** — CLIP ONNX models for semantic search across images and videos; content detection ONNX models; configurable batch size and model selection; GPU-accelerated with automatic VRAM release after idle
- **Content review** — filter images by semantic similarity and/or content detections; bulk quarantine matches
- **Identify & Rename** — search TMDB to identify a folder of badly-named files, match them to episodes via drag-and-drop, and apply Plex/Jellyfin-compatible renames with automatic folder restructuring
- **Job queue** — background job system with live progress, logs, and cancellation
- **Three themes** — violet, cyan, amber

---

## Deployment

### Choosing a runtime

The image must be built with a `RUNTIME` build argument matching your hardware. There is no pre-built image — build it locally.

| `RUNTIME` | When to use |
|-----------|-------------|
| `cpu` (default) | No GPU, or GPU only for ffmpeg transcoding |
| `cuda` | NVIDIA GPU — enables ONNX GPU inference + NVENC transcoding |
| `rocm` | AMD GPU — enables ONNX ROCm inference + VA-API transcoding |

---

### Docker Compose (recommended)

Create a `docker-compose.yml` and a `data/` directory alongside it:

```yaml
services:
  parallax:
    build:
      context: .
      args:
        RUNTIME: cuda          # cpu | cuda | rocm
    image: parallax:cuda
    container_name: parallax
    ports:
      - "7899:7899"
    volumes:
      - ./data:/app/data       # database, thumbnails, keyframes, model cache
      - /mnt/media:/media      # your media — add as many mounts as needed
    environment:
      - DATA_DIR=/app/data
      - HF_HOME=/app/data/hf-cache
    user: "1000:1000"          # match your host UID:GID
    restart: unless-stopped

    # ── NVIDIA (requires nvidia-container-toolkit on the host) ──
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu, video]

    # ── Intel / AMD (VA-API) — swap in instead of the nvidia block ──
    # devices:
    #   - /dev/dri:/dev/dri
    # group_add:
    #   - video
```

```bash
git clone https://github.com/raslan/parallax.git
cd parallax
docker compose up -d --build
```

Open [http://localhost:7899](http://localhost:7899).

> **Note:** Always pass `--build`. A plain `docker compose up` won't pick up code changes.

---

### Docker Run

Build first, then run:

```bash
# CPU
docker build -t parallax:cpu .

# NVIDIA CUDA
docker build --build-arg RUNTIME=cuda -t parallax:cuda .

# AMD ROCm
docker build --build-arg RUNTIME=rocm -t parallax:rocm .
```

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
  parallax:cpu
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
  parallax:cuda
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
  parallax:rocm
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
2. Go to **Settings → AI Models** to download CLIP and content detection models
3. Go to **Settings → Metadata** and add a free [TMDB API key](https://www.themoviedb.org/settings/api) to enable the Identify feature
4. Add a library under **Videos** or **Images** and start a scan

---

## Stack

- **Backend** — Python 3.12, FastAPI, SQLAlchemy, SQLite, ffmpeg
- **Frontend** — React, TypeScript, Vite, shadcn/ui, Tailwind CSS
- **Container** — multi-stage Docker build (Node → Python), single port, three runtime targets
