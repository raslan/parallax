import type {
  LeftReason,
  MatchRowState,
  RunEntry,
  RunItem,
  RunResult,
  TitleChoice,
} from "@/types/subtitle";
import type { Job } from "@/types/job";

export type SyncEngine = "alass" | "ffsubsync";

const SOURCE_NAMES: Record<string, string> = { subf2m: "Subf2m", yts: "YTS", search: "Search" };

/** A subtitle source's display name (`search` names a search request that failed outright). */
export const sourceName = (provider: string) => SOURCE_NAMES[provider] ?? provider;

/** The run dock's choices. Never saved anywhere: every run starts from `defaultRunOptions`. */
export interface RunOptions {
  keepExisting: boolean;
  syncAfter: boolean;
  engine: SyncEngine;
}

/** Both tickboxes off, the engine from Settings (alass when Settings has none we know). */
export function defaultRunOptions(settingsEngine: string): RunOptions {
  return {
    keepExisting: false,
    syncAfter: false,
    engine: settingsEngine === "ffsubsync" ? "ffsubsync" : "alass",
  };
}

/**
 * A row "Approve all clean rows" takes: a candidate nothing flagged, whose length check has
 * settled (a result, an error, or checks skipped), so a row about to be flagged is never
 * approved by a click that came a moment too early.
 */
export function isClean(row: MatchRowState, checksSkipped = false): boolean {
  const settled = !!row.lengthResult || checksSkipped;
  return (
    (row.status === "ready" || row.status === "replaces_machine") &&
    !!row.candidate &&
    settled &&
    row.outcome !== "saved" // automatic save already saved it
  );
}

/** Why automatic save left a row for the user, in plain words. */
export const LEFT_REASON_TEXT: Record<LeftReason, string> = {
  identity_unconfirmed: "Title not confirmed",
  episode_unknown: "Season or episode not read from the name",
  only_season_pack: "Only a season pack was found",
  length_short: "Looks too short for the video",
  length_long: "Looks too long for the video",
  length_unchecked: "Length could not be checked",
  none_found: "Nothing found",
  failed: "Failed",
};

/**
 * Whether a title's identity is certain: Identify's folder layout was recognised, or the user
 * chose or confirmed it here. A guess from file names alone is not, however clear it looks:
 * automatic save never saves for such a title.
 */
export function identityCertain(choice: TitleChoice): boolean {
  return choice.group.layout_clean || choice.confirmed === true;
}

/** The approved rows as run items, in row order. */
export function runItems(rows: MatchRowState[]): RunItem[] {
  return rows.flatMap((r) =>
    r.candidate && (r.verdict === "use" || r.verdict === "use_and_sync")
      ? [
          {
            video_path: r.video,
            language: r.language,
            provider: r.candidate.provider,
            subtitle_id: r.candidate.subtitle_id,
            sync: r.verdict === "use_and_sync",
            season: r.season,
            episode: r.episode,
          },
        ]
      : [],
  );
}

/** What a run job stores in its settings: its items, its choices and the results so far. */
export interface ParsedRun {
  path: string | null;
  items: RunItem[];
  results: RunResult[];
  keepExisting: boolean;
  syncAfter: boolean;
  engine: SyncEngine | null;
}

/** Reads a run job's stored items; null for a job without one (or not loaded yet). */
export function parseRunJob(job: Job | undefined | null): ParsedRun | null {
  if (!job?.settings) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(job.settings);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.items)) return null;
  return {
    path: typeof s.path === "string" ? s.path : null,
    items: s.items as RunItem[],
    results: Array.isArray(s.results) ? (s.results as RunResult[]) : [],
    keepExisting: s.keep_existing === true,
    syncAfter: s.sync_after === true,
    engine: s.engine === "alass" || s.engine === "ffsubsync" ? s.engine : null,
  };
}

const entryKey = (videoPath: string, language: string) => `${videoPath}\u0000${language}`;

/**
 * Each item of a run with its result. An item with no result is still waiting, or, once
 * the job has ended (a cancel), skipped.
 */
export function runEntries(run: ParsedRun, ended: boolean): RunEntry[] {
  const byKey = new Map(run.results.map((r) => [entryKey(r.video_path, r.language), r]));
  return run.items.map((item) => {
    const result = byKey.get(entryKey(item.video_path, item.language)) ?? null;
    return { item, result, state: result ? result.status : ended ? "skipped" : "waiting" };
  });
}

/** An earlier run's entries with a later run's (a retry) put in their place. */
export function mergeEntries(earlier: RunEntry[], later: RunEntry[]): RunEntry[] {
  const byKey = new Map(later.map((e) => [entryKey(e.item.video_path, e.item.language), e]));
  const seen = new Set<string>();
  const out = earlier.map((e) => {
    const k = entryKey(e.item.video_path, e.item.language);
    seen.add(k);
    return byKey.get(k) ?? e;
  });
  for (const e of later) {
    if (!seen.has(entryKey(e.item.video_path, e.item.language))) out.push(e);
  }
  return out;
}
