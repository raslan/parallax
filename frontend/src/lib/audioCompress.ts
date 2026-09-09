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

/** Percent smaller the estimate is vs the source, floored at 0, one decimal.
 *  Mirrors the backend's `audio_savings_pct` — keep identical. */
export function audioSavingsPct(sourceBytes: number, estBytes: number): number {
  if (!sourceBytes) return 0;
  return Math.max(0, Math.round((1 - estBytes / sourceBytes) * 1000) / 10);
}
