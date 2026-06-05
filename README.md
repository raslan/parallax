# Parallax

A self-hosted video and image library manager with hardware-accelerated compression, duplicate detection, subtitle management, and media identification. Runs in Docker, accessible from any browser.

![Parallax demo](demo.gif)

## Features

### Videos
- **Library management** — scan video folders; browse by status, resolution, bitrate, duration; split into sub-libraries; libraries auto-rescan when files change on disk
- **Compression** — re-encode to H.264, HEVC, or AV1 via the dedicated Compress page; hardware-accelerated with NVIDIA NVENC and Intel/AMD VA-API; CRF slider with live estimated savings; smart-select by codec (e.g. "non-HEVC") or corruption status; cancelable bulk job with per-file progress; originals preserved in `_originals/`
- **Duplicate detection** — find duplicates by size, duration, and perceptual hash; configurable similarity threshold (0–100%), first-frame/all-frames comparison mode, and frames-per-video (4–64); scan is self-contained and runs pHash extraction automatically before comparing
- **Cleanup** — filter and bulk-delete by duration, resolution, FPS, date, filename (exact or fuzzy), CLIP semantic match, or content detections; all filters stack with invert/exclude support
- **Identify & Rename** — search TMDB to identify a folder of badly-named files, match them to episodes via drag-and-drop, and apply Plex/Jellyfin-compatible renames with automatic folder restructuring
- **Subtitles** — scan a folder for missing subtitle files; bulk-download best matches or open a Plex-style search dialog; powered by subf2m.co (no account, no daily limit, multi-language); Whisper local speech-to-text generates SRT files from audio with no API key; multiple subtitle tracks shown in the Plyr player with a language picker

### Images
- **Library management** — scan image folders with automatic thumbnail generation; browse and filter your collection; libraries auto-rescan when files change on disk
- **Duplicate detection** — find duplicate images by perceptual hash with configurable similarity threshold
- **Semantic search** — CLIP-powered natural language search across your entire image library
- **Content review** — filter by semantic similarity and/or content detections; bulk quarantine flagged images; restore or permanently delete from quarantine

### AI
- **Semantic search** — natural language search across image and video libraries using CLIP; describe a scene or subject and find matching files instantly
- **Content detection** — flag inappropriate content with configurable confidence thresholds; review, quarantine, or bulk-delete flagged files
- **Local speech-to-text** — generate subtitle files from audio with Whisper; no API key or cloud upload required; auto-detects spoken language; five model sizes (tiny → large-v3)
- **GPU-accelerated** — CUDA and ROCm backends; inference runs in isolated subprocesses so VRAM is fully freed when idle; batch size tunable per your hardware

### Downloads
- **yt-dlp integration** — paste one or more URLs and queue downloads with live progress; supports YouTube, Vimeo, Twitch, and thousands of other sites
- **Quality & codec control** — choose resolution (Best/4K/1080p/720p/480p/360p) and codec preference (Auto/H.264/H.265/AV1/VP9); quality-first fallback so codec degrades gracefully before resolution does
- **Audio mode** — extract audio-only in mp3/m4a/opus
- **Browser impersonation** — one-click enable with a dropdown of available targets from the installed binary; requires curl-cffi (included in the `yt-dlp_linux` standalone binary)
- **Cookies** — paste Netscape-format cookies for session-only auth (age-restricted and logged-in content); ephemeral, never written to disk
- **Trimming** — download a clip by setting start/end timestamps
- **Subtitles** — optionally download subtitle files alongside the video
- **yt-dlp management** — install/update from Settings → Downloads; stable or nightly channel; binary lives in the data volume and persists across rebuilds; quick Update button on the Downloads page shows current version
- **Download history** — persists across restarts; clear from list (file kept) or delete with file (shift-click skips confirm)
- **Playback** — completed downloads play in the built-in Plyr player with subtitle support

### General
- **Job queue** — background jobs with live progress, phase labels, logs, and cancellation
- **Library delete safety** — when deleting a library that has `_originals/` or `_quarantine/` leftovers, prompts to delete them, review them, or keep them on disk
- **Seven themes** — violet (Deep Space, default), cyan (Modern HUD), amber (Mission Control), OLED, rose, emerald, indigo — selectable in Settings → General

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

### NVIDIA prerequisites (Linux only)

Requires the NVIDIA driver and container toolkit installed on the host before running a CUDA build.

#### for Debian / Ubuntu

1. **Install kernel headers and build tools** — required for the driver's DKMS module to compile against your running kernel.

2. **Install the latest NVIDIA driver** — distro repos often lag; follow [NVIDIA's driver installation guide for Debian/Ubuntu](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/debian.html) to get a current version. RTX 50xx (Blackwell) requires driver ≥ 570.

3. **Reboot** — the driver won't be active until the system restarts. Verify with `nvidia-smi` after rebooting.

4. **Install NVIDIA Container Toolkit** — follow the official guide at [docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html). This is what allows Docker to pass the GPU into containers.

5. **Configure the Docker runtime** — run `nvidia-ctk runtime configure --runtime=docker` then `systemctl restart docker`. This adds the NVIDIA runtime to `/etc/docker/daemon.json`.

---

## First run

1. Open [http://localhost:7899](http://localhost:7899)
2. Go to **Settings → AI Models** to download CLIP and content detection models (required for AI features on both videos and images)
3. Go to **Settings → Keys & Accounts** and add a free [TMDB API key](https://www.themoviedb.org/settings/api) to enable the Identify feature — subtitle downloads via subf2m.co need no account or API key
4. To use the Downloads feature, go to **Settings → Downloads** and click **Install yt-dlp** — choose stable or nightly channel first
5. Add a library — **Videos → Add Library** for a video folder, **Images → Add Library** for an image folder
6. Run a scan; for video libraries the AI scan extracts frames via fast seeks (no full-video decode) then runs CLIP on 3 midpoint frames and NudeNet on all frames; for image libraries it generates thumbnails and runs the same AI pipeline; duplicate detection on the Duplicates page is self-contained — it extracts pHash automatically before comparing

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

- **Backend** — Python 3.12, FastAPI, SQLAlchemy, SQLite, ffmpeg, babelfish, guessit
- **Frontend** — React, TypeScript, Vite, shadcn/ui, Tailwind CSS
- **Container** — multi-stage Docker build (Node → Python), single port, three runtime targets
