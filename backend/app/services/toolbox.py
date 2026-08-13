import os
import re
import subprocess


def _build_toolbox_cmd(
    input_path: str,
    output_path: str,
    duration: float,
    trim_start: float,
    trim_end: float,
    audio_channel: str | None,   # "left" | "right" | None — already resolved, "auto" is resolved upstream
    rotate_deg: int | None,      # 90 | 180 | 270 | None
    normalize: bool,
    faststart: bool,
    sync_offset_ms: float | None,
) -> list[str]:
    needs_video_reencode = rotate_deg is not None
    needs_audio_reencode = audio_channel is not None or normalize or sync_offset_ms is not None
    has_dual_input = sync_offset_ms is not None

    ss_args = ["-ss", str(trim_start)] if trim_start > 0 else []

    cmd = ["ffmpeg", "-y", *ss_args, "-i", input_path]

    if has_dual_input:
        cmd += [*ss_args, "-itsoffset", str(sync_offset_ms / 1000), "-i", input_path]
        cmd += ["-map", "0:v", "-map", "1:a?"]
    else:
        cmd += ["-map", "0:v", "-map", "0:a?"]

    if trim_start > 0 or trim_end > 0:
        clip_len = max(duration - trim_start - trim_end, 0.1)
        cmd += ["-t", str(clip_len)]

    vf_filters = []
    if rotate_deg == 90:
        vf_filters.append("transpose=1")
    elif rotate_deg == 270:
        vf_filters.append("transpose=2")
    elif rotate_deg == 180:
        vf_filters.append("transpose=1,transpose=1")
    if vf_filters:
        cmd += ["-vf", ",".join(vf_filters)]

    cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "medium"] if needs_video_reencode else ["-c:v", "copy"]

    af_filters = []
    if audio_channel == "left":
        af_filters.append("pan=stereo|c0=c0|c1=c0")
    elif audio_channel == "right":
        af_filters.append("pan=stereo|c0=c1|c1=c1")
    if normalize:
        af_filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    if af_filters:
        cmd += ["-af", ",".join(af_filters)]

    cmd += ["-c:a", "aac", "-b:a", "192k"] if needs_audio_reencode else ["-c:a", "copy"]

    out_ext = os.path.splitext(output_path)[1].lower()
    if faststart and out_ext in {".mp4", ".m4v", ".mov"}:
        cmd += ["-movflags", "+faststart"]

    cmd += ["-progress", "pipe:1", "-nostats", output_path]
    return cmd


_CHANNEL_BLOCK_RE = re.compile(r"Channel:\s*(\d+)\s*.*?RMS level dB:\s*(-?[\d.]+|-inf)", re.S)


def parse_channel_rms(astats_output: str) -> dict[int, float]:
    """Parse ffmpeg `-filter:a astats` stderr text into {channel_number: rms_db}."""
    result: dict[int, float] = {}
    for chan_str, rms_str in _CHANNEL_BLOCK_RE.findall(astats_output):
        result[int(chan_str)] = float("-inf") if rms_str == "-inf" else float(rms_str)
    return result


def detect_louder_channel(path: str) -> str:
    """Run ffmpeg astats on the file's audio, return 'left' or 'right' — whichever channel has higher RMS."""
    proc = subprocess.run(
        ["ffmpeg", "-i", path, "-filter:a", "astats", "-f", "null", "-"],
        capture_output=True, text=True, timeout=60,
    )
    rms = parse_channel_rms(proc.stderr)
    left_db = rms.get(1, float("-inf"))
    right_db = rms.get(2, float("-inf"))
    return "left" if left_db >= right_db else "right"
