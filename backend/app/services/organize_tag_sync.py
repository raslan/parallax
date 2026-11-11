"""Keep libraries in step after Organize writes tags into files.

Organize has no database of its own, but a folder it edits may also be a library. A tag write
replaces the file's bytes (size changes, and a rewrite is a new file), so the library that
contains it is nudged the way Splice and Upscale nudge the watcher, and a video's cached byte
hash (an exact-copy fingerprint) is cleared. The pHash and shared-audio data stay: the frames
and the audio did not change. The write restores the file's modification time, so the
library's "file added" date stays what it was.

Never raises: a failed refresh must not turn a written file into an error.
"""

import logging
import os

from app.services import fs_watcher
from app.services.organize_sandbox import kind_of

logger = logging.getLogger(__name__)


def _inside(path: str, folder: str) -> bool:
    folder = folder.rstrip(os.sep)
    return path.startswith(folder + os.sep)


def refresh_libraries(paths: list[str]) -> None:
    """Tell every library that contains one of ``paths`` that those files changed."""
    if not paths:
        return
    try:
        from app.database import SessionLocal
        from app.models.audio_library import AudioLibrary
        from app.models.file import File
        from app.models.image_library import ImageLibrary
        from app.models.library import Library

        groups: dict[tuple[str, int], set[str]] = {}
        db = SessionLocal()
        try:
            for kind, model in (
                ("video", Library),
                ("audio", AudioLibrary),
                ("image", ImageLibrary),
            ):
                for lib_id, lib_path in db.query(model.id, model.path).all():
                    for path in paths:
                        if kind_of(os.path.basename(path)) == kind and _inside(path, lib_path):
                            groups.setdefault((kind, lib_id), set()).add(path)
            video_paths = [p for p in paths if kind_of(os.path.basename(p)) == "video"]
            if video_paths:
                db.query(File).filter(File.path.in_(video_paths)).update(
                    {File.byte_hash: None}, synchronize_session=False
                )
                db.commit()
        finally:
            db.close()
        for (kind, lib_id), changed in groups.items():
            fs_watcher._apply(kind, lib_id, frozenset(changed))  # type: ignore[arg-type]
    except Exception as e:
        logger.warning("could not refresh libraries after a tag write: %s", type(e).__name__)
