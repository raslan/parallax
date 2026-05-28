# Parallax

A self-hosted video library manager with transcoding, duplicate detection, and media identification. Runs in Docker, accessible from any browser.

## Features

- **Library management** — scan folders of video or image files; browse by status; split into sub-libraries
- **Transcoding** — re-encode files using ffmpeg with hardware acceleration (NVIDIA NVENC, Intel/AMD VA-API); preserves originals and tracks savings
- **Duplicate detection** — find duplicate files by size, duration, and perceptual hash; keep the best copy and delete the rest
- **Cleanup** — filter and bulk-delete video files by duration, resolution, FPS, date, filename (exact or fuzzy), CLIP semantic match, or NudeNet content detections; all filters stack and support invert/exclude mode
- **Image library** — scan image folders with thumbnail generation, pHash deduplication, CLIP semantic search, and NudeNet content detection; quarantine and restore workflow
- **AI scanning** — CLIP ONNX models for semantic search across images and videos; NudeNet ONNX models for content detection; configurable batch size and model selection; GPU-accelerated with automatic VRAM release after idle
- **Content review** — filter images by semantic similarity and/or content detections; bulk quarantine matches
- **Identify & Rename** — search TMDB to identify a folder of badly-named files, match them to episodes via drag-and-drop, and apply Plex/Jellyfin-compatible renames with automatic folder restructuring
- **Job queue** — background job system with live progress, logs, and cancellation
- **Three themes** — violet, cyan, amber

## Quick start

```bash
git clone https://github.com/raslan/parallax.git
cd parallax
docker compose up -d
```

Open [http://localhost:7899](http://localhost:7899).

## Configuration

Edit `docker-compose.yml` to mount your media folders:

```yaml
volumes:
  - ./data:/app/data
  - /your/media:/media   # add as many as you need
```

The default port is `7899`. Override it with the `PORT` environment variable.

## Hardware acceleration

### NVIDIA (NVENC)

Requires [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) on the host. The GPU section in `docker-compose.yml` is enabled by default.

### Intel / AMD (VA-API)

Comment out the `deploy.resources` block in `docker-compose.yml` and uncomment the `devices` section:

```yaml
devices:
  - /dev/dri:/dev/dri
group_add:
  - video
```

## TMDB API key

The Identify feature requires a free TMDB API key. Add it under **Settings → Metadata** after the app is running.

## Stack

- **Backend** — Python 3.12, FastAPI, SQLAlchemy, SQLite, ffmpeg
- **Frontend** — React, TypeScript, Vite, shadcn/ui, Tailwind CSS
- **Container** — multi-stage Docker build, single port
