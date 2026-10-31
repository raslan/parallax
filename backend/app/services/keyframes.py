"""Video keyframe times, used to plan HLS segment boundaries.

Matroska files carry their keyframes in the Cues index, so those are read directly
(a few KB, instant even on a 50 GB remux). Anything else falls back to ffprobe, which has to
demux the whole file but only emits keyframe packets. Same split Jellyfin uses.
"""

import logging
import os
import struct
import subprocess
from collections.abc import Callable, Iterator

logger = logging.getLogger(__name__)

# EBML / Matroska element ids (marker bits kept, as they appear on disk)
_EBML = 0x1A45DFA3
_SEGMENT = 0x18538067
_SEEK_HEAD = 0x114D9B74
_SEEK = 0x4DBB
_SEEK_ID = 0x53AB
_SEEK_POSITION = 0x53AC
_INFO = 0x1549A966
_TIMESTAMP_SCALE = 0x2AD7B1
_DURATION = 0x4489
_TRACKS = 0x1654AE6B
_TRACK_ENTRY = 0xAE
_TRACK_NUMBER = 0xD7
_TRACK_TYPE = 0x83
_CLUSTER = 0x1F43B675
_CUES = 0x1C53BB6B
_CUE_POINT = 0xBB
_CUE_TIME = 0xB3
_CUE_TRACK_POSITIONS = 0xB7
_CUE_TRACK = 0xF7
_TRACK_TYPE_VIDEO = 1


def _vint(f, keep_marker: bool) -> tuple[int, bool]:
    """Read an EBML variable-length integer. Returns (value, is_unknown_size)."""
    first = f.read(1)
    if not first:
        raise EOFError
    b = first[0]
    length, mask = 1, 0x80
    while length <= 8 and not b & mask:
        mask >>= 1
        length += 1
    if length > 8:
        raise ValueError("bad EBML vint")
    rest = f.read(length - 1)
    if len(rest) != length - 1:
        raise EOFError
    value = b if keep_marker else b & (mask - 1)
    for x in rest:
        value = (value << 8) | x
    return value, (not keep_marker) and value == (1 << (7 * length)) - 1


def _header(f, offset: int) -> tuple[int, int, int | None]:
    """(element id, data start, data size or None if unknown) of the element at `offset`."""
    f.seek(offset)
    eid, _ = _vint(f, True)
    size, unknown = _vint(f, False)
    return eid, f.tell(), None if unknown else size


def _children(f, start: int, end: int) -> Iterator[tuple[int, int, int, int]]:
    """Child elements in [start, end) as (id, element offset, data start, data size)."""
    pos = start
    while pos < end:
        try:
            eid, data, size = _header(f, pos)
        except (EOFError, ValueError):
            return
        if size is None:  # unknown-size element (live stream) — can't skip it
            yield eid, pos, data, end - data
            return
        yield eid, pos, data, size
        pos = data + size


def _uint(f, data: int, size: int) -> int:
    f.seek(data)
    return int.from_bytes(f.read(size), "big")


def _float(f, data: int, size: int) -> float:
    f.seek(data)
    raw = f.read(size)
    return struct.unpack(">f" if size == 4 else ">d", raw)[0] if size in (4, 8) else 0.0


def _matroska(path: str) -> tuple[float, list[float]] | None:
    """(duration, keyframe times) in seconds from the Cues of the first video track."""
    with open(path, "rb") as f:
        eid, data, size = _header(f, 0)
        if eid != _EBML or size is None:
            return None
        eid, seg, _ = _header(f, data + size)
        if eid != _SEGMENT:
            return None
        end = os.path.getsize(path)

        where: dict[int, int] = {}
        for cid, off, cdata, csize in _children(f, seg, end):
            if cid == _CLUSTER:
                break
            if cid == _SEEK_HEAD:
                for sid, _, sdata, ssize in _children(f, cdata, cdata + csize):
                    if sid != _SEEK:
                        continue
                    target = pos = None
                    for kid, _, kdata, ksize in _children(f, sdata, sdata + ssize):
                        if kid == _SEEK_ID:
                            f.seek(kdata)
                            target = int.from_bytes(f.read(ksize), "big")
                        elif kid == _SEEK_POSITION:
                            pos = _uint(f, kdata, ksize)
                    if target is not None and pos is not None:
                        where.setdefault(target, seg + pos)
            elif cid in (_INFO, _TRACKS, _CUES):
                where[cid] = off
        if not all(k in where for k in (_INFO, _TRACKS, _CUES)):
            return None

        _, data, size = _header(f, where[_INFO])
        scale, duration = 1_000_000, 0.0
        for cid, _, cdata, csize in _children(f, data, data + (size or 0)):
            if cid == _TIMESTAMP_SCALE:
                scale = _uint(f, cdata, csize)
            elif cid == _DURATION:
                duration = _float(f, cdata, csize)

        _, data, size = _header(f, where[_TRACKS])
        video = None
        for cid, _, cdata, csize in _children(f, data, data + (size or 0)):
            if cid != _TRACK_ENTRY:
                continue
            number = kind = None
            for kid, _, kdata, ksize in _children(f, cdata, cdata + csize):
                if kid == _TRACK_NUMBER:
                    number = _uint(f, kdata, ksize)
                elif kid == _TRACK_TYPE:
                    kind = _uint(f, kdata, ksize)
            if kind == _TRACK_TYPE_VIDEO:
                video = number
                break
        if video is None:
            return None

        _, data, size = _header(f, where[_CUES])
        times: list[float] = []
        for cid, _, cdata, csize in _children(f, data, data + (size or 0)):
            if cid != _CUE_POINT:
                continue
            cue_time, tracks = None, []
            for kid, _, kdata, ksize in _children(f, cdata, cdata + csize):
                if kid == _CUE_TIME:
                    cue_time = _uint(f, kdata, ksize)
                elif kid == _CUE_TRACK_POSITIONS:
                    for pid, _, pdata, psize in _children(f, kdata, kdata + ksize):
                        if pid == _CUE_TRACK:
                            tracks.append(_uint(f, pdata, psize))
            if cue_time is not None and video in tracks:
                times.append(cue_time * scale / 1e9)
        if not times:
            return None
        return duration * scale / 1e9, sorted(set(times))


def _ffprobe(
    path: str, on_progress: Callable[[float], None] | None
) -> tuple[float, list[float]] | None:
    """Slow path: ffprobe demuxes the whole file, emitting only keyframe packets."""
    duration = _probe_duration(path)
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-skip_frame",
        "nokey",
        "-show_entries",
        "packet=pts_time,flags",
        "-select_streams",
        "v:0",
        "-of",
        "csv",
        path,
    ]
    times: list[float] = []
    try:
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True) as proc:
            for line in proc.stdout:
                parts = line.strip().split(",")
                if len(parts) < 3 or parts[0] != "packet" or not parts[2].startswith("K"):
                    continue
                try:
                    times.append(float(parts[1]))
                except ValueError:
                    continue
                if on_progress and duration:
                    on_progress(min(0.99, times[-1] / duration))
    except OSError:
        return None
    if not times:
        return None
    return duration or times[-1], sorted(set(times))


def _probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout.strip()
        return float(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def extract_keyframes(
    path: str, on_progress: Callable[[float], None] | None = None
) -> tuple[float, list[float]] | None:
    """(duration, keyframe times) in seconds, or None when none could be found."""
    try:
        found = _matroska(path)
    except (OSError, EOFError, ValueError, struct.error) as exc:
        logger.debug("Matroska Cues unreadable for %s (%s); using ffprobe", path, exc)
        found = None
    return found or _ffprobe(path, on_progress)
