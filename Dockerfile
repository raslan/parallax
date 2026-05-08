# Stage 1: build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + built frontend
FROM python:3.12-slim

# ffmpeg is required for scanning and transcoding
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy built frontend so FastAPI can serve it as static files
COPY --from=frontend-builder /frontend/dist ./static

RUN mkdir -p /app/data

EXPOSE 7899

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7899"]
