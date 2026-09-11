import os

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")
GALLERY_DL_DIR = os.path.join(DATA_DIR, "gallery-dl")

# Optional fast-disk staging directory for in-progress Compress/Toolbox output
# (video and audio). Fixed path, no env override, no setting — its only
# control is whether something is bind-mounted here at container start. Never
# created by the app: if it's not a real directory, `temp_sibling_path` falls
# straight back to writing next to the source file, so an unmounted deployment
# behaves exactly as if this didn't exist.
SCRATCH_DIR = "/app/scratch"
