"""Audio and image scan jobs: what they must do when the library's folder is gone, and the image
scan's `reset` option. (The video scan's tests are in `test_scanner_video.py`.)"""

import os
import shutil

import pytest
from PIL import Image

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.image import ImageDetection, ImageFile
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.services import audio_scanner, image_scanner
from tests.media_fakes import audio_probe


def _add(factory, *rows):
    s = factory()
    s.add_all(rows)
    s.commit()
    ids = [r.id for r in rows]
    s.close()
    return ids


def _job(factory, job_type, library_id):
    (job_id,) = _add(factory, Job(type=job_type, status=JobStatus.PENDING, library_id=library_id))
    return job_id


def _job_state(factory, job_id):
    s = factory()
    try:
        job = s.get(Job, job_id)
        return job.status, job.error
    finally:
        s.close()


@pytest.fixture
def no_followup(monkeypatch):
    import app.queue

    calls = []
    monkeypatch.setattr(app.queue, "enqueue_threadsafe", lambda *a: calls.append(a))
    return calls


@pytest.fixture
def no_nudenet(monkeypatch):
    from app.services import image_analyzer

    monkeypatch.setattr(
        image_analyzer,
        "run_nudenet_batch_arrays",
        lambda arrays, model_id="320n": [[] for _ in arrays],
    )
    monkeypatch.setattr(image_analyzer, "release_sessions", lambda: None)


def _png(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", (32, 24), (10, 20, 30)).save(path)
    return str(path)


def _image_row(library_id, path):
    return ImageFile(
        library_id=library_id,
        path=str(path),
        filename=os.path.basename(path),
        extension="png",
        size=1,
    )


# --- a library whose folder is gone -----------------------------------------


def test_an_audio_scan_of_a_vanished_folder_fails_and_keeps_every_row(
    fs_db, audio_probes, no_followup, tmp_path
):
    root = tmp_path / "music"
    track = root / "a.mp3"
    os.makedirs(root)
    track.write_bytes(b"x")
    audio_probes[str(track)] = audio_probe()
    (lib_id,) = _add(fs_db, AudioLibrary(name="Music", path=str(root)))
    _add(fs_db, AudioFile(library_id=lib_id, path=str(track), filename="a.mp3"))
    shutil.rmtree(root)
    job_id = _job(fs_db, JobType.AUDIO_SCAN, lib_id)

    audio_scanner.scan_audio_library(lib_id, job_id)

    status, error = _job_state(fs_db, job_id)
    assert status == JobStatus.FAILED and "folder not found" in error.lower()
    s = fs_db()
    assert s.query(AudioFile).count() == 1  # the row survives; it is not "deleted from disk"
    s.close()


def test_an_image_scan_of_a_vanished_folder_fails_and_a_reset_does_not_wipe_the_rows(
    fs_db, no_followup, no_nudenet, tmp_path
):
    root = tmp_path / "pics"
    (lib_id,) = _add(fs_db, ImageLibrary(name="Pics", path=str(root)))  # the folder never exists
    _add(fs_db, _image_row(lib_id, root / "a.png"))
    job_id = _job(fs_db, JobType.IMAGE_SCAN, lib_id)

    image_scanner.scan_image_library(lib_id, job_id, run_phash=False, run_nudenet=False, reset=True)

    status, error = _job_state(fs_db, job_id)
    assert status == JobStatus.FAILED and "folder not found" in error.lower()
    s = fs_db()
    assert s.query(ImageFile).count() == 1
    s.close()


# --- the image scan's reset option ------------------------------------------


def test_a_reset_scan_of_a_library_with_detections_rebuilds_it(
    fs_db, no_followup, no_nudenet, tmp_path
):
    """Reset deletes the library's image rows and re-reads the folder. Detections reference
    those rows (foreign keys are enforced), so they must go first — as they do when the whole
    library is deleted — or the delete fails and the scan dies before reading a single file."""
    root = tmp_path / "pics"
    paths = [_png(root / f"{i}.png") for i in range(2)]
    (lib_id,) = _add(fs_db, ImageLibrary(name="Pics", path=str(root)))
    image_ids = _add(fs_db, *[_image_row(lib_id, p) for p in paths])
    _add(
        fs_db, *[ImageDetection(image_id=i, label="FACE_FEMALE", confidence=0.9) for i in image_ids]
    )
    job_id = _job(fs_db, JobType.IMAGE_SCAN, lib_id)

    image_scanner.scan_image_library(lib_id, job_id, run_phash=False, run_nudenet=False, reset=True)

    status, error = _job_state(fs_db, job_id)
    assert status == JobStatus.COMPLETED, error
    s = fs_db()
    assert sorted(r.path for r in s.query(ImageFile)) == sorted(paths)
    assert s.query(ImageDetection).count() == 0  # the old rows' detections went with them
    s.close()
