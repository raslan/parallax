import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";
import type { AudioFile } from "@/types/audio";
import { anyAudioCriteriaEnabled } from "@/types/audioDuplicate";

export interface AudioDuplicateGroup {
  files: AudioFile[];
  keep_id: number;
}

// Message shapes for clusterAudioDuplicates.worker.ts — mirrors
// clusterDuplicates.ts. The fingerprint stage is O(n^2) per group, so the
// worker keeps the tab responsive while it computes.
export interface ClusterRequest {
  requestId: number;
  files: AudioFile[];
  criteria: AudioDuplicateCriteria;
}

export interface ClusterResponse {
  requestId: number;
  groups: AudioDuplicateGroup[];
}

// ── helpers copied verbatim from clusterDuplicates.ts (kept self-contained) ──

// 32-bit Hamming distance for audio fingerprint values, which are genuinely
// int32 and safe as plain JS numbers.
function hamming32(a: number, b: number, mask: number): number {
  let x = (a ^ b) & mask;
  let count = 0;
  while (x !== 0) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

// Average of per-frame minimum Hamming distances (avg-of-minimums).
function framesDistanceBy<T>(a: T[], b: T[], distance: (x: T, y: T) => number): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let total = 0;
  for (const va of a) total += Math.min(...b.map((vb) => distance(va, vb)));
  for (const vb of b) total += Math.min(...a.map((va) => distance(va, vb)));
  return total / (a.length + b.length);
}

function audioFramesDistance(a: number[], b: number[]): number {
  return framesDistanceBy(a, b, (x, y) => hamming32(x, y, 0xffffffff));
}

// audio_fingerprint is a JSON string column — a JSON array of int32 values.
function parseAudioFrames(json: string | null | undefined): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

function splitByKey<T extends { id: number }>(
  groups: T[][],
  getKey: (item: T) => string | number | null,
): T[][] {
  const next: T[][] = [];
  for (const group of groups) {
    const buckets = new Map<string | number, T[]>();
    for (const item of group) {
      const key = getKey(item);
      if (key == null) continue;
      const bucket = buckets.get(key) ?? [];
      bucket.push(item);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) if (bucket.length > 1) next.push(bucket);
  }
  return next;
}

function splitByTolerance<T extends { id: number }>(
  groups: T[][],
  getValue: (item: T) => number | null,
  tolerance: number,
): T[][] {
  const next: T[][] = [];
  for (const group of groups) {
    const valid = group
      .filter((item) => getValue(item) != null)
      .sort((a, b) => getValue(a)! - getValue(b)!);
    let i = 0;
    while (i < valid.length) {
      const anchor = getValue(valid[i]!)!;
      let j = i;
      const cluster: T[] = [];
      while (j < valid.length && getValue(valid[j]!)! - anchor <= tolerance) {
        cluster.push(valid[j]!);
        j++;
      }
      if (cluster.length > 1) next.push(cluster);
      i = j > i ? j : i + 1;
    }
  }
  return next;
}

function splitByPairwise<T extends { id: number }>(
  groups: T[][],
  distance: (a: T, b: T) => number,
  maxDistance: number,
): T[][] {
  const next: T[][] = [];
  for (const group of groups) {
    const used = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;
      const cluster: T[] = [group[i]!];
      used.add(i);
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        if (distance(group[i]!, group[j]!) <= maxDistance) {
          cluster.push(group[j]!);
          used.add(j);
        }
      }
      if (cluster.length > 1) next.push(cluster);
    }
  }
  return next;
}

// ── audio-specific ──

function pickKeep(files: AudioFile[]): number {
  return [...files].sort(
    (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0) || (b.size ?? 0) - (a.size ?? 0),
  )[0]!.id;
}

/**
 * Client-side duplicate-matching engine for the Audio Duplicates page. Runs
 * entirely in the browser, no server round-trip. Four stackable criteria in a
 * cheapest-first funnel — exact size, duration (± tolerance), content date (±
 * tolerance) and audio fingerprint (chromaprint, Hamming distance) — each
 * enabled stage only narrows groups that already have 2+ members. With no
 * criteria enabled at all, returns no groups.
 */
export function clusterAudioDuplicates(
  files: AudioFile[],
  criteria: AudioDuplicateCriteria,
): AudioDuplicateGroup[] {
  if (!anyAudioCriteriaEnabled(criteria)) return [];

  let groups: AudioFile[][] = [files];

  if (criteria.use_size) groups = splitByKey(groups, (f) => f.size);

  if (criteria.use_duration) {
    groups = splitByTolerance(groups, (f) => f.duration, criteria.duration_tolerance);
  }

  if (criteria.use_content_date) {
    groups = splitByTolerance(groups, (f) => f.file_date, criteria.content_date_tolerance);
  }

  if (criteria.use_audio) {
    const maxDistance = (1 - criteria.audio_threshold) * 32; // 32 bits per fingerprint value
    groups = splitByPairwise(
      groups,
      (a, b) =>
        audioFramesDistance(
          parseAudioFrames(a.audio_fingerprint),
          parseAudioFrames(b.audio_fingerprint),
        ),
      maxDistance,
    );
  }

  return groups.filter((g) => g.length > 1).map((g) => ({ files: g, keep_id: pickKeep(g) }));
}
