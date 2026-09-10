"""Audio Toolbox: fix one or more audio files with a stackable set of
operations — trim, channel fix, two-pass EBU R128 loudness normalisation.

Structurally mirrors `services/toolbox.py` (the video Toolbox job runner) with
every video concern removed. Pure command builders live at the top and are
unit-tested without touching ffmpeg or the DB.
"""

import json
import re

from app.services.audio_compressor import _has_encoder

LOUDNORM_TARGET = "I=-16:TP=-1.5:LRA=11"
CHANNEL_OPS = ("mono", "downmix_stereo", "left_to_both", "right_to_both")

# lossy source codec -> (preferred encoder, fallback encoder, fallback bitrate
# when the source bitrate is unknown). Lossless codecs are handled separately.
_LOSSY_ENCODERS: dict[str, tuple[str, str, str]] = {
    "aac": ("libfdk_aac", "aac", "192k"),
    "mp3": ("libmp3lame", "libmp3lame", "192k"),
    "opus": ("libopus", "libopus", "128k"),
    "vorbis": ("libvorbis", "libvorbis", "160k"),
}
_LOSSLESS_ENCODERS: dict[str, str] = {
    "flac": "flac",
    "alac": "alac",
}
_DEFAULT_LOSSY = ("libfdk_aac", "aac", "192k")


def _encoder_for_source(codec_name: str | None, bitrate_bps: int | None) -> tuple[str, str | None]:
    """Resolve (encoder, bitrate_arg) for re-encoding a file back into its own
    codec family. bitrate_arg is None for lossless targets."""
    codec = (codec_name or "").lower()

    if codec.startswith("pcm_"):
        return "pcm_s16le", None
    if codec in _LOSSLESS_ENCODERS:
        return _LOSSLESS_ENCODERS[codec], None

    preferred, fallback, fallback_bitrate = _LOSSY_ENCODERS.get(codec, _DEFAULT_LOSSY)
    encoder = preferred if _has_encoder(preferred) else fallback

    if bitrate_bps and bitrate_bps > 0:
        bitrate_arg = f"{round(bitrate_bps / 1000)}k"
    else:
        bitrate_arg = fallback_bitrate
    return encoder, bitrate_arg


def _parse_loudnorm_json(stderr_text: str) -> dict | None:
    """Pull the trailing JSON object ffmpeg's loudnorm prints with
    print_format=json. Scans from the last '{' that yields valid JSON."""
    starts = [m.start() for m in re.finditer(r"\{", stderr_text)]
    for start in reversed(starts):
        chunk = stderr_text[start:]
        end = chunk.rfind("}")
        while end != -1:
            try:
                data = json.loads(chunk[: end + 1])
            except ValueError:
                end = chunk.rfind("}", 0, end)
                continue
            if "input_i" in data:
                return {
                    "input_i": str(data["input_i"]),
                    "input_tp": str(data["input_tp"]),
                    "input_lra": str(data["input_lra"]),
                    "input_thresh": str(data["input_thresh"]),
                    "target_offset": str(data.get("target_offset", "0.0")),
                }
            end = chunk.rfind("}", 0, end)
    return None


def _loudnorm_filter(measured: dict | None) -> str:
    if not measured:
        return f"loudnorm={LOUDNORM_TARGET}"
    return (
        f"loudnorm={LOUDNORM_TARGET}"
        f":measured_I={measured['input_i']}"
        f":measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}"
        f":measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}"
        f":linear=true"
    )


def _build_audio_toolbox_cmd(
    src: str,
    out: str,
    *,
    duration: float,
    trim_start: float,
    trim_end: float,
    channel_op: str | None,
    normalize: bool,
    encoder: str,
    bitrate_arg: str | None,
    measured: dict | None,
) -> list[str]:
    reencode = normalize or channel_op is not None

    cmd: list[str] = ["ffmpeg", "-y"]
    if trim_start > 0:
        cmd += ["-ss", str(trim_start)]
    cmd += ["-i", src]

    if trim_start > 0 or trim_end > 0:
        clip_len = duration - trim_start - trim_end
        cmd += ["-t", str(clip_len)]

    cmd += ["-map", "0:a:0", "-map_metadata", "0", "-map_metadata:s:a", "0", "-map_chapters", "0"]

    af: list[str] = []
    if channel_op == "left_to_both":
        af.append("pan=stereo|c0=c0|c1=c0")
    elif channel_op == "right_to_both":
        af.append("pan=stereo|c0=c1|c1=c1")
    if normalize:
        af.append(_loudnorm_filter(measured))
    if af:
        cmd += ["-af", ",".join(af)]

    if channel_op == "mono":
        cmd += ["-ac", "1"]
    elif channel_op == "downmix_stereo":
        cmd += ["-ac", "2"]

    if reencode:
        cmd += ["-c:a", encoder]
        if bitrate_arg:
            cmd += ["-b:a", bitrate_arg]
    else:
        cmd += ["-c:a", "copy"]

    cmd += ["-progress", "pipe:1", "-nostats", out]
    return cmd
