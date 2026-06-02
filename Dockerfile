# Build tagged images for each runtime:
#   docker build -t parallax .
#   docker build --build-arg RUNTIME=cuda -t parallax:cuda .
#   docker build --build-arg RUNTIME=rocm -t parallax:rocm .
ARG RUNTIME=cpu

# Stage 1: build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2a: CPU-only base (default)
FROM python:3.12-slim AS base-cpu
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Stage 2b: NVIDIA CUDA base
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS base-cuda
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3.12 python3.12-venv python3.12-dev libcublas-12-4 && \
    python3.12 -m ensurepip --upgrade && \
    python3.12 -m pip install --upgrade pip && \
    rm -rf /var/lib/apt/lists/*

# Stage 2c: AMD ROCm base
FROM rocm/dev-ubuntu-22.04:6.0.2 AS base-rocm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3.12 python3.12-venv python3.12-dev && \
    python3.12 -m ensurepip --upgrade && \
    python3.12 -m pip install --upgrade pip && \
    rm -rf /var/lib/apt/lists/*

# Final stage: select base via RUNTIME arg
ARG RUNTIME=cpu
FROM base-${RUNTIME}

WORKDIR /app

COPY backend/requirements.txt ./
ARG RUNTIME=cpu
# Install requirements first, then force-reinstall the correct onnxruntime variant
# so nudenet's CPU onnxruntime dependency doesn't overwrite the GPU build.
RUN python3.12 -m pip install --no-cache-dir -r requirements.txt && \
    case "${RUNTIME}" in \
      cuda) python3.12 -m pip install --no-cache-dir --force-reinstall onnxruntime-gpu==1.20.1 ;; \
      rocm) python3.12 -m pip install --no-cache-dir --force-reinstall onnxruntime-rocm ;; \
      *)    python3.12 -m pip install --no-cache-dir --force-reinstall onnxruntime==1.20.1 ;; \
    esac

COPY backend/ ./

# Copy built frontend so FastAPI can serve it as static files
COPY --from=frontend-builder /frontend/dist ./static

ARG PUID=1000
ARG PGID=1000
RUN mkdir -p /app/data && chown -R ${PUID}:${PGID} /app

EXPOSE 7899

CMD ["python3.12", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7899"]
