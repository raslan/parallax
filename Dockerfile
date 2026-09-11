# Build the image:
#   docker build -t parallax .
ARG APP_VERSION=dev
# jellyfin-ffmpeg replaces the stock ffmpeg the Debian base would otherwise
# pull in. NVENC/NVDEC and VA-API hardware transcode work purely through
# runtime device passthrough (nvidia-container-toolkit's `video` capability,
# or a plain /dev/dri mount) — neither needs the CUDA or ROCm toolkit baked
# into the image itself. jellyfin-ffmpeg8 tracks a current ffmpeg release and
# includes chromaprint (needed for audio_fingerprint.py), vaapi, and
# nvenc/nvdec in one package.
ARG JELLYFIN_FFMPEG_VERSION=8.1.2-4
ARG JELLYFIN_FFMPEG_DEB=jellyfin-ffmpeg8_8.1.2-4-trixie_amd64.deb

# Stage 1: build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG APP_VERSION=dev
RUN VITE_APP_VERSION=$APP_VERSION npm run build

# Stage 2: runtime base — CPU-only Python, jellyfin-ffmpeg for hw transcode
FROM python:3.12-slim AS base
ARG JELLYFIN_FFMPEG_VERSION
ARG JELLYFIN_FFMPEG_DEB
RUN apt-get update && \
    apt-get install -y --no-install-recommends unar curl && \
    curl -fL -o /tmp/jellyfin-ffmpeg.deb \
      "https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v${JELLYFIN_FFMPEG_VERSION}/${JELLYFIN_FFMPEG_DEB}" && \
    apt-get install -y --no-install-recommends /tmp/jellyfin-ffmpeg.deb && \
    rm /tmp/jellyfin-ffmpeg.deb && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./
RUN python3.12 -m pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy built frontend so FastAPI can serve it as static files
COPY --from=frontend-builder /frontend/dist ./static

RUN mkdir -p /app/data

EXPOSE 7899

CMD ["python3.12", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7899"]
