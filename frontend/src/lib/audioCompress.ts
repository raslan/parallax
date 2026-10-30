/** Estimated compressed size in bytes for a lossy audio re-encode at a target
 *  bitrate. Near-exact: audio size is ~linear in bitrate, no scene-complexity
 *  variance. ~2% container overhead. Mirrors the backend's
 *  `estimate_audio_size` in `audio_compressor.py` — keep the arithmetic
 *  identical. */
export function estimateAudioSize(
  durationS: number | null | undefined,
  bitrateKbps: number,
): number {
  if (!durationS || durationS <= 0) return 0;
  return Math.floor(((durationS * bitrateKbps * 1000) / 8) * 1.02);
}

/** A lossy encode lands a little above the bitrate it was asked for (VBR, container
 *  overhead): Opus @128k measures roughly 116-140k. Mirrors the backend's
 *  `SAME_CODEC_HEADROOM` — keep identical. */
const SAME_CODEC_HEADROOM = 1.15;

/** True when re-encoding can't help: the source is at/below the target bitrate, or is
 *  already the target codec within the headroom above it (so a file this app already
 *  compressed is not picked up again). Unknown bitrate → false. Mirrors the backend's
 *  `is_already_at_target` — keep identical. */
export function isAlreadyAtTarget(
  srcCodec: string | null | undefined,
  srcBitrateBps: number | null | undefined,
  targetCodec: string,
  targetKbps: number,
): boolean {
  if (!srcBitrateBps) return false;
  const limit = targetKbps * 1000 * (srcCodec === targetCodec ? SAME_CODEC_HEADROOM : 1);
  return srcBitrateBps <= limit;
}

/** Percent smaller the estimate is vs the source, floored at 0, one decimal.
 *  Mirrors the backend's `audio_savings_pct` — keep identical. */
export function audioSavingsPct(sourceBytes: number, estBytes: number): number {
  if (!sourceBytes) return 0;
  return Math.max(0, Math.round((1 - estBytes / sourceBytes) * 1000) / 10);
}
