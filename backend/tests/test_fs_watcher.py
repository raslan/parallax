"""fs_watcher watch bookkeeping — video and image library IDs both start at 1,
so the watch registry must namespace by (is_image, library_id) or the second
library scheduled silently overwrites/short-circuits the first."""

from app.services import fs_watcher


class _StubObserver:
    def __init__(self):
        self.scheduled = []

    def schedule(self, handler, path, recursive):
        h = (handler, path)
        self.scheduled.append(h)
        return h

    def unschedule(self, handle):
        self.scheduled.remove(handle)


def _reset(monkeypatch):
    obs = _StubObserver()
    monkeypatch.setattr(fs_watcher, "_observer", obs)
    monkeypatch.setattr(fs_watcher, "_handles", {})
    monkeypatch.setattr(fs_watcher, "_pending", {})
    return obs


def test_same_id_video_and_image_both_watched(monkeypatch):
    obs = _reset(monkeypatch)

    fs_watcher.watch_library(1, "/media/vid", is_image=False)
    fs_watcher.watch_library(1, "/media/img", is_image=True)

    assert len(obs.scheduled) == 2
    assert set(fs_watcher._handles) == {(False, 1), (True, 1)}


def test_unwatch_targets_the_right_library(monkeypatch):
    obs = _reset(monkeypatch)
    fs_watcher.watch_library(1, "/media/vid", is_image=False)
    fs_watcher.watch_library(1, "/media/img", is_image=True)

    fs_watcher.unwatch_library(1, is_image=True)

    assert set(fs_watcher._handles) == {(False, 1)}
    assert [p for _, p in obs.scheduled] == ["/media/vid"]


def test_watch_is_idempotent_per_key(monkeypatch):
    obs = _reset(monkeypatch)
    fs_watcher.watch_library(1, "/media/vid", is_image=False)
    fs_watcher.watch_library(1, "/media/vid", is_image=False)
    assert len(obs.scheduled) == 1


# --- dispatch event filtering ------------------------------------------------
# watchdog 4.x emits FileOpenedEvent/FileClosedEvent on Linux for any open,
# reads included. Recording those as changes made _fire loop forever (it opens
# every file to probe it, re-emitting an open event).


def _evt(name, src="/media/vid/a.mp4", dest=None):
    ns = {"is_directory": False, "src_path": src}
    if dest is not None:
        ns["dest_path"] = dest
    return type(name, (), ns)()


def _dispatch_and_drain(monkeypatch, *events):
    _reset(monkeypatch)
    fired = []
    monkeypatch.setattr(fs_watcher, "_fire", lambda key: fired.append(key))
    h = fs_watcher._Handler(1, is_image=False)
    for e in events:
        h.dispatch(e)
    state = fs_watcher._pending.get((False, 1))
    if state and state.timer:
        state.timer.cancel()
    return state


def test_open_close_events_are_ignored(monkeypatch):
    state = _dispatch_and_drain(
        monkeypatch,
        _evt("FileOpenedEvent"),
        _evt("FileClosedEvent"),
        _evt("FileClosedNoWriteEvent"),
    )
    assert state is None  # nothing recorded, no timer scheduled


def test_created_and_modified_are_recorded(monkeypatch):
    state = _dispatch_and_drain(
        monkeypatch,
        _evt("FileCreatedEvent"),
        _evt("FileModifiedEvent"),
    )
    assert state.changed == {"/media/vid/a.mp4"}


def test_delete_and_move_recorded(monkeypatch):
    state = _dispatch_and_drain(
        monkeypatch,
        _evt("FileDeletedEvent", src="/media/vid/old.mp4"),
        _evt("FileMovedEvent", src="/media/vid/x.mp4", dest="/media/vid/y.mp4"),
    )
    assert "/media/vid/old.mp4" in state.deleted
    assert "/media/vid/x.mp4" in state.deleted
    assert state.changed == {"/media/vid/y.mp4"}
