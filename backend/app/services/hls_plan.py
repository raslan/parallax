"""HLS segment plan for a stream-copied video, built from its keyframe times.

ffmpeg's hls muxer cuts a stream-copied segment at the first keyframe at or after
`hls_time * n`, counted from the first packet of the *run*. A run restarted mid-file therefore
cuts differently from one started at the top, so the plan is split into chunks of
`CHUNK_SEGMENTS` segments, each anchored at its own first keyframe. A run always begins at a chunk
start and is stopped at the chunk end, so its cuts are exactly the planned ones wherever it started.
"""

import bisect
from dataclasses import dataclass

SEGMENT_SECONDS = 6.0
CHUNK_SEGMENTS = 15
# Float noise margin when comparing a keyframe time to a cut target.
_EPSILON = 1e-4


@dataclass(frozen=True)
class Segment:
    start: float
    duration: float


def plan_segments(
    keyframes: list[float],
    duration: float,
    target: float = SEGMENT_SECONDS,
    chunk: int = CHUNK_SEGMENTS,
) -> list[Segment]:
    """Segments covering [0, duration), cut only at keyframes, `chunk` per anchored chunk."""
    if not keyframes or duration <= 0:
        return []
    cuts = [0.0]
    anchor = keyframes[0]
    while True:
        last = None
        for n in range(1, chunk + 1):
            # One target per segment written; the cut must also land after the previous one.
            i = max(
                bisect.bisect_left(keyframes, anchor + n * target - _EPSILON),
                bisect.bisect_right(keyframes, cuts[-1]),
            )
            if i >= len(keyframes) or keyframes[i] >= duration:
                last = None
                break
            last = keyframes[i]
            cuts.append(last)
        if last is None:
            break
        anchor = last
    ends = cuts[1:] + [max(duration, cuts[-1])]
    return [Segment(a, b - a) for a, b in zip(cuts, ends) if b > a]


def chunk_start(index: int, chunk: int = CHUNK_SEGMENTS) -> int:
    """Index of the first segment of the chunk containing segment `index`."""
    return index - index % chunk


def media_playlist(segments: list[Segment], init: str, segment_name: str) -> str:
    """VOD media playlist; `segment_name` is a format string taking the segment index."""
    longest = max((s.duration for s in segments), default=SEGMENT_SECONDS)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        f"#EXT-X-TARGETDURATION:{int(longest) + (0 if longest == int(longest) else 1)}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        f'#EXT-X-MAP:URI="{init}"',
    ]
    for i, seg in enumerate(segments):
        lines += [f"#EXTINF:{seg.duration:.6f},", segment_name.format(i)]
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"
