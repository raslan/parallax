"""Fake ffprobe output for tests that need the scanners' real field-mapping code
(`probe_metadata`, `probe_audio_metadata`) without running ffprobe."""


def video_probe(
    *,
    duration: float = 10.0,
    size: int = 1000,
    codec: str = "h264",
    width: int = 1280,
    height: int = 720,
    fps: str = "30/1",
    bit_rate: int | None = 800_000,
    creation_time: str | None = None,
) -> dict:
    """What `ffprobe -show_entries stream=...,format=... -of json` prints for one video."""
    stream = {
        "codec_name": codec,
        "codec_type": "video",
        "width": width,
        "height": height,
        "r_frame_rate": fps,
    }
    if bit_rate is not None:
        stream["bit_rate"] = str(bit_rate)
    fmt: dict = {"duration": str(duration), "size": str(size)}
    if creation_time:
        fmt["tags"] = {"creation_time": creation_time}
    return {"streams": [stream], "format": fmt}


def audio_probe(
    *,
    duration: float = 180.0,
    size: int = 1000,
    codec: str = "mp3",
    sample_rate: int = 44100,
    channels: int = 2,
    bit_rate: int | None = 192_000,
) -> dict:
    stream = {
        "codec_name": codec,
        "sample_rate": str(sample_rate),
        "channels": channels,
        "channel_layout": "stereo" if channels == 2 else "mono",
    }
    if bit_rate is not None:
        stream["bit_rate"] = str(bit_rate)
    return {"streams": [stream], "format": {"duration": str(duration), "size": str(size)}}
