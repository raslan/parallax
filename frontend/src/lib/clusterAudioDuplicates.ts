import { keeperFirst, pickAudioKeep } from "./pickKeep";
import { splitBySharedAudio } from "./sharedAudio";
import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";
import type { AudioFile } from "@/types/audio";
import { anyAudioCriteriaEnabled } from "@/types/audioDuplicate";

export interface AudioDuplicateGroup {
  files: AudioFile[];
  keep_id: number;
}

// Message shapes for clusterAudioDuplicates.worker.ts — mirrors clusterDuplicates.ts so
// the grouping never blocks the main thread.
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

// ── audio-specific ──

/**
 * Client-side duplicate-matching engine for the Audio Duplicates page. Runs entirely in the
 * browser, no server round-trip. Four stackable criteria in a cheapest-first funnel — exact
 * size, duration (± tolerance), content date (± tolerance) and shared audio (measured by the
 * server's Find duplicates run) — each enabled stage only narrows groups that already have
 * 2+ members. With no criteria enabled at all, returns no groups. The suggested keeper is
 * listed first in its group.
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
    groups = splitBySharedAudio(groups, criteria.audio_threshold);
  }

  // Defensive invariant only: every split stage above already drops sub-2 groups, so this
  // filter is a no-op once any criterion has run — kept so a singleton can never reach
  // pickKeep. Mirrors the equivalent guard in clusterDuplicates.ts.
  return groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const keep_id = pickAudioKeep(g);
      return { files: keeperFirst(g, keep_id), keep_id };
    });
}
