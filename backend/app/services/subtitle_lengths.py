"""Compare a subtitle's last cue with the video's runtime. A hint, never a verdict."""

# A subtitle ending before 88% of the runtime is "short" (credits and recaps leave some slack).
SHORT_TOLERANCE = 0.12
# A subtitle ending more than 5% past the runtime is "long".
LONG_THRESHOLD = 1.05


def length_verdict(
    last_cue: float, video_duration: float | None, tolerance: float = SHORT_TOLERANCE
) -> str:
    if not video_duration or video_duration <= 0:
        return "unknown"
    if last_cue < video_duration * (1 - tolerance):
        return "short"
    if last_cue > video_duration * LONG_THRESHOLD:
        return "long"
    return "ok"
