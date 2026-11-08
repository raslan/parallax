// The criteria of the video and audio Duplicates pages: their defaults, loading the saved ones,
// and the rules for when the last server run no longer fits them (the "Results may be
// incomplete" banner). Plain functions, so the page logic can be tested without a page.

import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { Job } from "@/types/job";

export const CRITERIA_KEY = "parallax-dup-criteria-v2"; // v2: shape changed (10 fields), don't reuse v1's key

export function defaultCriteria(): DuplicateCriteria {
  return {
    use_size: true,
    use_duration: true,
    duration_tolerance: 1,
    use_resolution: false,
    use_content_date: false,
    content_date_tolerance: 86400,
    use_orientation: false,
    use_bitrate: false,
    bitrate_tolerance_pct: 10,
    use_filename: false,
    filename_threshold: 0.4,
    use_byte_hash: false,
    use_phash: true,
    phash_threshold: 10,
    phash_mode: "first_frame",
    phash_frames: 16,
    use_audio: false,
    audio_threshold: 0.9,
    audio_similarity: 0.75,
    audio_min_stretch: 10,
  };
}

/**
 * The saved criteria, laid over the defaults: criteria saved before a field existed (like the
 * shared-audio dials) get that field's default instead of `undefined`. Unreadable or missing
 * saved data gives the defaults.
 */
export function loadCriteria(storage: Pick<Storage, "getItem"> = localStorage): DuplicateCriteria {
  try {
    const stored = storage.getItem(CRITERIA_KEY);
    if (stored) return { ...defaultCriteria(), ...JSON.parse(stored) };
  } catch {
    // fall through to defaults
  }
  return defaultCriteria();
}

/**
 * True when the current video criteria could include a pair that was not a candidate when the
 * server last ran (`last`), so the stored extraction may be incomplete: a tolerance loosened, a
 * signal switched on, more pHash frames, or a free-tier criterion switched off (which widens
 * the set of files that reach the slow stages).
 */
export function criteriaReachFurther(
  criteria: DuplicateCriteria,
  last: DuplicateCriteria,
): boolean {
  return (
    criteria.duration_tolerance > last.duration_tolerance ||
    criteria.content_date_tolerance > last.content_date_tolerance ||
    criteria.bitrate_tolerance_pct > last.bitrate_tolerance_pct ||
    (criteria.use_byte_hash && !last.use_byte_hash) ||
    (criteria.use_phash && !last.use_phash) ||
    (criteria.use_phash && criteria.phash_frames !== last.phash_frames) ||
    (criteria.use_phash && criteria.phash_mode !== last.phash_mode) ||
    (criteria.use_audio && !last.use_audio) ||
    (!criteria.use_size && last.use_size) ||
    (!criteria.use_duration && last.use_duration) ||
    (!criteria.use_resolution && last.use_resolution) ||
    (!criteria.use_content_date && last.use_content_date) ||
    (!criteria.use_orientation && last.use_orientation) ||
    (!criteria.use_bitrate && last.use_bitrate) ||
    (!criteria.use_filename && last.use_filename) ||
    // A lower filename threshold matches more files, same direction as loosening a tolerance.
    criteria.filename_threshold < last.filename_threshold
  );
}

/** The same for the audio page's four criteria. */
export function audioCriteriaReachFurther(
  criteria: AudioDuplicateCriteria,
  last: AudioDuplicateCriteria,
): boolean {
  return (
    criteria.duration_tolerance > last.duration_tolerance ||
    criteria.content_date_tolerance > last.content_date_tolerance ||
    (criteria.use_audio && !last.use_audio) ||
    (!criteria.use_size && last.use_size) ||
    (!criteria.use_duration && last.use_duration) ||
    (!criteria.use_content_date && last.use_content_date)
  );
}

/** The two server-side Shared audio dials a stored result was measured with. */
export interface MeasuredDials {
  audio_similarity: number;
  audio_min_stretch: number;
}

/**
 * The dials of the latest finished run of `type` for this library that measured shared audio
 * (the server records them in the job's `settings`), or null when there is none. A run with
 * Shared audio off leaves the stored values alone and records nothing, so it is skipped.
 */
export function measuredAudioDials(
  jobs: readonly Job[],
  type: string,
  libraryId: number | null,
): MeasuredDials | null {
  let latest: Job | null = null;
  for (const job of jobs) {
    if (job.type !== type || job.library_id !== libraryId || job.status !== "completed") continue;
    if (!job.settings) continue;
    if (latest === null || job.id > latest.id) latest = job;
  }
  if (latest?.settings == null) return null;
  try {
    const parsed: unknown = JSON.parse(latest.settings);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { audio_similarity, audio_min_stretch } = parsed as Record<string, unknown>;
    if (typeof audio_similarity !== "number" || typeof audio_min_stretch !== "number") return null;
    return { audio_similarity, audio_min_stretch };
  } catch {
    return null;
  }
}

/**
 * True when the "Sounds alike" or "Shared for at least" sliders differ from what the stored
 * shared-audio values were measured with, in either direction (stricter leaves matches that no
 * longer qualify, looser misses ones that now would). The baseline is what the server recorded
 * (it survives a reload), or else the criteria this session's last run was sent with.
 */
export function audioDialsStale(
  criteria: MeasuredDials & { use_audio: boolean },
  measured: MeasuredDials | null,
  lastSent: (MeasuredDials & { use_audio: boolean }) | null,
): boolean {
  if (!criteria.use_audio) return false;
  const baseline = measured ?? (lastSent?.use_audio ? lastSent : null);
  if (baseline === null) return false;
  return (
    criteria.audio_similarity !== baseline.audio_similarity ||
    criteria.audio_min_stretch !== baseline.audio_min_stretch
  );
}

/**
 * Whether to ignore the live-files stream. A page's own job writes file rows, and the stream
 * reports them a tick or two after the job says it is done (a 2 s tick against a 1.5 s poll),
 * so they are not changes from outside. Ignored while the job runs and until `quietUntil`.
 * The cost: a file the watcher adds during that window does not raise the banner.
 */
export function ignoreLiveStream(extracting: boolean, quietUntil: number, now: number): boolean {
  return extracting || now < quietUntil;
}

/** How long after its own job a Duplicates page keeps ignoring the stream. */
export const LIVE_QUIET_MS = 6000;
