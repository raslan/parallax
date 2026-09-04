import { bigramSimilarity } from "./cleanupFields";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";

export interface DuplicateGroup {
  files: VideoFile[];
  keep_id: number;
}

type Orientation = "square" | "landscape" | "portrait";

function orientation(f: VideoFile): Orientation | null {
  if (f.file_width == null || f.file_height == null) return null;
  if (f.file_width === f.file_height) return "square";
  return f.file_width > f.file_height ? "landscape" : "portrait";
}

// 64-bit Hamming distance for pHash values (signed int64, transported as
// decimal strings — see parsePhashFrames). JS's `^`/`&` bitwise operators
// coerce to 32-bit signed integers, which would silently truncate the upper
// bits of a 64-bit value — use BigInt to compare the full width.
function hamming64(a: bigint, b: bigint): number {
  let x = (BigInt.asUintN(64, a) ^ BigInt.asUintN(64, b)) & 0xffffffffffffffffn;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

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

// Average of per-frame minimum Hamming distances (avg-of-minimums), generic
// over the value type + distance function so pHash (bigint/64-bit) and audio
// fingerprint (number/32-bit) can share the same shape.
function framesDistanceBy<T>(a: T[], b: T[], distance: (x: T, y: T) => number): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let total = 0;
  for (const va of a) total += Math.min(...b.map((vb) => distance(va, vb)));
  for (const vb of b) total += Math.min(...a.map((va) => distance(va, vb)));
  return total / (a.length + b.length);
}

function phashFramesDistance(a: bigint[], b: bigint[]): number {
  return framesDistanceBy(a, b, hamming64);
}

function audioFramesDistance(a: number[], b: number[]): number {
  return framesDistanceBy(a, b, (x, y) => hamming32(x, y, 0xffffffff));
}

// phash_frames is a JSON array of decimal-string int64 values (see
// backend/app/services/duplicates.py) — parse each as a BigInt to preserve
// full 64-bit precision (a plain JS number can't exactly represent int64
// values beyond +-2^53).
function parsePhashFrames(json: string | null): bigint[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => BigInt(v));
  } catch {
    return [];
  }
}

function parseAudioFrames(json: string | null): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
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

// True when at least one of the 10 stackable criteria is enabled. Shared
// between clusterDuplicates (to decide whether the pass-through single group
// applies) and the Duplicates page (to avoid auto-selecting the entire
// library for deletion when nothing is actually narrowing the funnel).
export function anyCriteriaEnabled(criteria: DuplicateCriteria): boolean {
  return (
    criteria.use_size ||
    criteria.use_duration ||
    criteria.use_resolution ||
    criteria.use_content_date ||
    criteria.use_orientation ||
    criteria.use_bitrate ||
    criteria.use_filename ||
    criteria.use_byte_hash ||
    criteria.use_phash ||
    criteria.use_audio
  );
}

function pickKeep(files: VideoFile[]): number {
  return [...files].sort(
    (a, b) => (b.video_bitrate ?? 0) - (a.video_bitrate ?? 0) || (b.size ?? 0) - (a.size ?? 0),
  )[0]!.id;
}

export function clusterDuplicates(
  files: VideoFile[],
  criteria: DuplicateCriteria,
): DuplicateGroup[] {
  let groups: VideoFile[][] = [files];

  if (criteria.use_size) groups = splitByKey(groups, (f) => f.size);
  if (groups.length === 0 && files.length < 2) return [];

  if (criteria.use_duration) {
    groups = splitByTolerance(groups, (f) => f.duration, criteria.duration_tolerance);
  }

  if (criteria.use_resolution) {
    groups = splitByKey(groups, (f) =>
      f.file_width != null && f.file_height != null ? `${f.file_width}x${f.file_height}` : null,
    );
  }

  if (criteria.use_content_date) {
    groups = splitByTolerance(groups, (f) => f.file_date, criteria.content_date_tolerance);
  }

  if (criteria.use_orientation) {
    groups = splitByKey(groups, orientation);
  }

  if (criteria.use_bitrate) {
    const tolPct = criteria.bitrate_tolerance_pct / 100;
    const next: VideoFile[][] = [];
    for (const group of groups) {
      const valid = group
        .filter((f) => f.video_bitrate != null)
        .sort((a, b) => a.video_bitrate! - b.video_bitrate!);
      let i = 0;
      while (i < valid.length) {
        const anchor = valid[i]!.video_bitrate!;
        let j = i;
        const cluster: VideoFile[] = [];
        while (j < valid.length && valid[j]!.video_bitrate! - anchor <= anchor * tolPct) {
          cluster.push(valid[j]!);
          j++;
        }
        if (cluster.length > 1) next.push(cluster);
        i = j > i ? j : i + 1;
      }
    }
    groups = next;
  }

  if (criteria.use_filename) {
    groups = splitByPairwise(
      groups,
      (a, b) => (bigramSimilarity(a.filename, b.filename) >= criteria.filename_threshold ? 0 : 1),
      0,
    );
  }

  if (criteria.use_byte_hash) {
    groups = splitByKey(groups, (f) => f.byte_hash);
  }

  if (criteria.use_phash) {
    if (criteria.phash_mode === "first_frame") {
      groups = splitByPairwise(
        groups,
        (a, b) =>
          a.phash != null && b.phash != null
            ? hamming64(BigInt(a.phash), BigInt(b.phash))
            : Infinity,
        criteria.phash_threshold,
      );
    } else {
      groups = splitByPairwise(
        groups,
        (a, b) =>
          phashFramesDistance(parsePhashFrames(a.phash_frames), parsePhashFrames(b.phash_frames)),
        criteria.phash_threshold,
      );
    }
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

  // With no criteria enabled at all, no splitting stage ran and the single
  // starting group (the whole library, even a library of one file) should
  // pass through as-is. Once any stage runs, groups are formed by actual
  // matching, so singletons (no match found) are excluded.
  const enabled = anyCriteriaEnabled(criteria);

  // Guard against the pass-through single group being empty (e.g. a library
  // with zero files, or no files loaded yet) — pickKeep assumes at least one
  // file, so an empty group must never reach it.
  const finalGroups = (enabled ? groups.filter((g) => g.length > 1) : groups).filter(
    (g) => g.length > 0,
  );
  return finalGroups.map((g) => ({ files: g, keep_id: pickKeep(g) }));
}
