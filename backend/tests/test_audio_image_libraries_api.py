"""Audio and image library routes: the twins of `test_libraries_api.py` — overlap on create,
delete cleanup, the job scoping that keeps one kind's delete away from another kind's jobs (the
three kinds' library ids all count from 1), leftovers and the job triggers."""

import os

import pytest

from app.models.audio_file import AudioFile
from app.models.audio_library import AudioLibrary
from app.models.image import ImageDetection, ImageFile
from app.models.image_library import ImageLibrary
from app.models.job import Job, JobStatus, JobType
from app.models.library import Library
from app.services import common

AUDIO = "/api/audio-libraries"
IMAGE = "/api/image-libraries"


def _write(path, size=10):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"x" * size)
    return str(path)


def _add(env, *rows):
    s = env.Session()
    s.add_all(rows)
    s.commit()
    ids = [r.id for r in rows]
    s.close()
    return ids


def _job(env, job_type, library_id, status=JobStatus.RUNNING):
    (job_id,) = _add(env, Job(type=job_type, status=status, library_id=library_id))
    return job_id


# --- create: overlap --------------------------------------------------------


@pytest.mark.parametrize("api", [AUDIO, IMAGE])
def test_create_registers_watches_and_refuses_overlapping_folders(lib_env, api):
    kind = "audio" if api == AUDIO else "image"
    outer = lib_env.root / "media"
    (outer / "inner").mkdir(parents=True)
    (lib_env.root / "media2").mkdir()

    created = lib_env.client.post(api, json={"name": "outer", "path": str(outer)})
    assert created.status_code == 201
    body = created.json()
    lib = body[0] if isinstance(body, list) else body
    assert lib_env.events == [("watch", kind, lib["id"])]

    for path in (str(outer), str(outer) + "/", str(outer / "inner"), str(lib_env.root)):
        r = lib_env.client.post(api, json={"name": "x", "path": path})
        assert r.status_code == 409, path
        assert "overlaps" in r.json()["detail"]
    assert lib_env.client.post(api, json={"path": str(lib_env.root / "media2")}).status_code == 201
    assert lib_env.client.post(api, json={"path": str(lib_env.root / "nope")}).status_code == 400


def test_a_video_library_does_not_block_an_audio_or_image_library_on_the_same_folder(lib_env):
    """Different tables, different unique constraints: one folder can hold a video library and
    an audio library (and an image library) at once."""
    folder = lib_env.root / "mixed"
    folder.mkdir()
    _add(lib_env, Library(name="v", path=str(folder)))

    assert lib_env.client.post(AUDIO, json={"path": str(folder)}).status_code == 201
    assert lib_env.client.post(IMAGE, json={"path": str(folder)}).status_code == 201


def test_audio_split_skips_overlapping_subfolders_and_reports_when_none_are_new(lib_env):
    for name in ("Rock", "Jazz", ".hidden"):
        (lib_env.root / "music" / name).mkdir(parents=True)
    body = {"path": str(lib_env.root / "music"), "split_into_sublibraries": True}

    first = lib_env.client.post(AUDIO, json=body)
    assert sorted(lib["name"] for lib in first.json()) == ["Jazz", "Rock"]

    again = lib_env.client.post(AUDIO, json=body)
    assert again.status_code == 409 and "already exist" in again.json()["detail"]
    empty = lib_env.root / "empty"
    empty.mkdir()
    r = lib_env.client.post(AUDIO, json={"path": str(empty), "split_into_sublibraries": True})
    assert r.status_code == 422


# --- audio: read / update ---------------------------------------------------


def test_audio_list_update_and_counts(lib_env):
    root = lib_env.root / "music"
    root.mkdir()
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))
    _add(lib_env, AudioFile(library_id=lib_id, path=_write(root / "a.mp3"), filename="a.mp3"))

    assert [(lib["id"], lib["file_count"]) for lib in lib_env.client.get(AUDIO).json()] == [
        (lib_id, 1)
    ]
    r = lib_env.client.patch(
        f"{AUDIO}/{lib_id}", json={"name": "Tunes", "scan_automatically": True}
    )
    assert r.status_code == 200 and r.json()["name"] == "Tunes"
    assert lib_env.client.patch(f"{AUDIO}/999", json={"name": "x"}).status_code == 404


# --- delete -----------------------------------------------------------------


def test_audio_delete_removes_rows_stops_the_watcher_and_keeps_the_music(lib_env):
    root = lib_env.root / "music"
    track = _write(root / "a.mp3")
    backup = _write(root / "_originals" / "a.mp3")
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))
    _add(lib_env, AudioFile(library_id=lib_id, path=track, filename="a.mp3"))

    assert lib_env.client.delete(f"{AUDIO}/{lib_id}").status_code == 204

    s = lib_env.Session()
    assert s.get(AudioLibrary, lib_id) is None and s.query(AudioFile).count() == 0
    s.close()
    assert lib_env.events == [("unwatch", "audio", lib_id)]
    assert os.path.exists(track) and os.path.exists(backup)  # kept unless asked

    (again,) = _add(lib_env, AudioLibrary(name="Music again", path=str(root)))
    lib_env.client.delete(f"{AUDIO}/{again}?delete_leftovers=true")
    assert not os.path.exists(root / "_originals") and os.path.exists(track)
    assert lib_env.client.delete(f"{AUDIO}/999").status_code == 404


def test_audio_delete_cancels_every_audio_job_type_not_just_scan_and_compress(lib_env):
    root = lib_env.root / "music"
    root.mkdir()
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))
    job_ids = [
        _job(lib_env, t, lib_id)
        for t in (JobType.AUDIO_SCAN, JobType.AUDIO_DUPLICATES, JobType.AUDIO_TOOLBOX)
    ]

    lib_env.client.delete(f"{AUDIO}/{lib_id}")

    try:
        assert all(common.should_cancel(j) for j in job_ids)
        s = lib_env.Session()
        assert all(s.get(Job, j).library_id is None for j in job_ids)
        s.close()
    finally:
        for j in job_ids:
            common.clear_cancel(j)


def test_image_delete_removes_rows_detections_and_thumbnails_and_keeps_the_pictures(lib_env):
    root = lib_env.root / "pics"
    picture = _write(root / "a.png")
    quarantined = _write(root / "_quarantine" / "b.png")
    (lib_id,) = _add(lib_env, ImageLibrary(name="Pics", path=str(root)))
    (image_id,) = _add(
        lib_env,
        ImageFile(library_id=lib_id, path=picture, filename="a.png", extension="png", size=10),
    )
    _add(lib_env, ImageDetection(image_id=image_id, label="FACE_FEMALE", confidence=0.9))
    thumb = _write(lib_env.root / "image-thumbnails" / f"{image_id}.jpg")

    assert lib_env.client.delete(f"{IMAGE}/{lib_id}").status_code == 204

    s = lib_env.Session()
    assert s.get(ImageLibrary, lib_id) is None
    assert s.query(ImageFile).count() == 0 and s.query(ImageDetection).count() == 0
    s.close()
    assert not os.path.exists(thumb)
    assert os.path.exists(picture) and os.path.exists(quarantined)  # kept unless asked
    assert lib_env.events == [("unwatch", "image", lib_id)]

    (again,) = _add(lib_env, ImageLibrary(name="Pics again", path=str(root)))
    lib_env.client.delete(f"{IMAGE}/{again}?delete_leftovers=true")
    assert not os.path.exists(root / "_quarantine") and os.path.exists(picture)
    assert lib_env.client.delete(f"{IMAGE}/999").status_code == 404


@pytest.mark.parametrize(
    "delete_url,library_model,foreign_jobs",
    [
        (AUDIO, AudioLibrary, [JobType.SCAN, JobType.IMAGE_SCAN]),
        (IMAGE, ImageLibrary, [JobType.SCAN, JobType.AUDIO_SCAN]),
    ],
)
def test_deleting_a_library_leaves_other_kinds_jobs_with_the_same_id_alone(
    lib_env, delete_url, library_model, foreign_jobs
):
    root = lib_env.root / "x"
    root.mkdir()
    _add(lib_env, library_model(id=7, name="L", path=str(root)))
    foreign = [_job(lib_env, t, 7) for t in foreign_jobs]

    lib_env.client.delete(f"{delete_url}/7")

    try:
        assert not any(common.should_cancel(j) for j in foreign)
        s = lib_env.Session()
        assert all(s.get(Job, j).library_id == 7 for j in foreign)
        s.close()
    finally:
        for j in foreign:
            common.clear_cancel(j)


# --- leftovers --------------------------------------------------------------


@pytest.mark.parametrize(
    "api,model,dirname",
    [(AUDIO, AudioLibrary, "_originals"), (IMAGE, ImageLibrary, "_quarantine")],
)
def test_leftovers_counts_the_kinds_backup_folder(lib_env, api, model, dirname):
    root = lib_env.root / "lib"
    _write(root / dirname / "a.bin", 100)
    _write(root / "sub" / dirname / "b.bin", 50)
    _write(root / "live.bin", 999)
    (lib_id,) = _add(lib_env, model(name="L", path=str(root)))

    body = lib_env.client.get(f"{api}/{lib_id}/leftovers").json()

    assert body == {"has_leftovers": True, "dir_name": dirname, "count": 2, "total_bytes": 150}
    assert lib_env.client.get(f"{api}/999/leftovers").status_code == 404


# --- job triggers -----------------------------------------------------------


def test_audio_scan_and_duplicates_triggers(lib_env):
    root = lib_env.root / "music"
    root.mkdir()
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))

    r = lib_env.client.post(f"{AUDIO}/{lib_id}/scan")
    assert r.status_code == 202 and lib_env.enqueued[-1][1] == "scan_audio_library"
    assert lib_env.client.post(f"{AUDIO}/{lib_id}/scan").status_code == 409  # that job is pending
    assert lib_env.client.post(f"{AUDIO}/999/scan").status_code == 404

    url = f"{AUDIO}/{lib_id}/find-duplicates"
    assert lib_env.client.post(url).status_code == 422  # nothing indexed
    _add(lib_env, AudioFile(library_id=lib_id, path=_write(root / "a.mp3"), filename="a.mp3"))
    assert lib_env.client.post(url).status_code == 202
    assert lib_env.enqueued[-1][1] == "find_audio_duplicates"
    assert lib_env.client.post(url).status_code == 409
    assert lib_env.client.post(f"{AUDIO}/999/find-duplicates").status_code == 404


def test_image_scan_trigger_records_its_options_and_refuses_a_second_scan(lib_env):
    root = lib_env.root / "pics"
    root.mkdir()
    (lib_id,) = _add(lib_env, ImageLibrary(name="Pics", path=str(root)))
    body = {"run_phash": True, "run_nudenet": False, "reset": True}

    r = lib_env.client.post(f"{IMAGE}/{lib_id}/scan", json=body)

    assert r.status_code == 202
    (job_id, fn, args) = lib_env.enqueued[-1]
    assert (fn, args) == ("scan_image_library", (lib_id, job_id, True, False, True))
    assert lib_env.client.post(f"{IMAGE}/{lib_id}/scan", json=body).status_code == 409
    assert lib_env.client.post(f"{IMAGE}/999/scan", json=body).status_code == 404


# --- audio bulk delete ------------------------------------------------------


def test_audio_delete_one_file_that_cannot_be_moved_does_not_strand_the_others(
    lib_env, monkeypatch
):
    import shutil

    root = lib_env.root / "music"
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))
    rows = [
        AudioFile(library_id=lib_id, path=_write(root / n), filename=n, size=10)
        for n in ("a.mp3", "b.mp3", "c.mp3")
    ]
    ids = _add(lib_env, *rows)
    real_move = shutil.move

    def flaky(src, dst):
        if src.endswith("b.mp3"):
            raise PermissionError("read-only")
        return real_move(src, dst)

    monkeypatch.setattr(shutil, "move", flaky)

    r = lib_env.client.post("/api/audio-files/delete", json={"file_ids": ids})

    assert r.status_code == 500 and "b.mp3" in r.json()["detail"]
    assert (root / "b.mp3").exists()
    s = lib_env.Session()
    assert [f.filename for f in s.query(AudioFile)] == ["b.mp3"]  # a and c are forgotten
    s.close()
    assert lib_env.removals == [("audio", 2, 20)]


def test_audio_delete_never_overwrites_an_existing_backup(lib_env):
    root = lib_env.root / "music"
    (lib_id,) = _add(lib_env, AudioLibrary(name="Music", path=str(root)))
    _write(root / "_originals" / "song.mp3", 3)
    (file_id,) = _add(
        lib_env,
        AudioFile(library_id=lib_id, path=_write(root / "song.mp3", 10), filename="song.mp3"),
    )
    _write(root / "_originals" / f"song_{file_id}.mp3", 5)  # even the id-suffixed name is taken

    assert (
        lib_env.client.post("/api/audio-files/delete", json={"file_ids": [file_id]}).status_code
        == 204
    )

    sizes = sorted(p.stat().st_size for p in (root / "_originals").iterdir())
    assert sizes == [3, 5, 10]
