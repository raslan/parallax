import os

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")
GALLERY_DL_DIR = os.path.join(DATA_DIR, "gallery-dl")
