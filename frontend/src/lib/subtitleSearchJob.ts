import { kindsFor } from "@/lib/subtitleCoverage";
import { baseName } from "@/lib/path";
import { identityCertain } from "@/lib/subtitleRunDock";
import type { Job } from "@/types/job";
import type {
  LengthResult,
  MatchRowState,
  MatchScope,
  MatchStatus,
  SaveOptions,
  ScanFile,
  SearchRequest,
  SearchRowResult,
  SearchSettings,
  SubtitleProvider,
  TitleChoice,
} from "@/types/subtitle";

const SEARCH_TYPE = "subtitle_search";

/** A search job's `settings` as an object; null for any other job, or settings we cannot read. */
export function parseSearchSettings(job: Job | null | undefined): SearchSettings | null {
  if (!job || job.type !== SEARCH_TYPE || !job.settings) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(job.settings);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SearchSettings>;
  if (
    typeof s.path !== "string" ||
    !Array.isArray(s.languages) ||
    !Array.isArray(s.titles) ||
    !s.results ||
    typeof s.results !== "object"
  )
    return null;
  return s as SearchSettings;
}

/** The newest search job started from `folder`, in any state; null when there is none. */
export function lastSearchFor(jobs: Job[], folder: string | null): Job | null {
  if (folder === null) return null;
  let best: Job | null = null;
  for (const j of jobs) {
    if (j.type !== SEARCH_TYPE || (best && j.id < best.id)) continue;
    if (parseSearchSettings(j)?.path === folder) best = j;
  }
  return best;
}

/** One line on how a finished search went, from the server's own words. */
export function searchSummary(job: Job): string {
  if (job.status === "failed") return job.error ? `failed: ${job.error}` : "failed";
  return job.current_file ?? "";
}

/**
 * The body of `POST /subtitles/searches` for the titles the user kept: a row for every video
 * and wanted language that needs a search (scope `missing` leaves out a language the video
 * already has a real subtitle in; `all` searches every one), and each title's identity with
 * whether it is certain.
 */
export function buildSearchRequest({
  folder,
  choices,
  wanted,
  sources,
  scope,
  checkLengths,
  save,
}: {
  folder: string;
  choices: (TitleChoice & { videos: ScanFile[] })[];
  wanted: string[];
  sources: SubtitleProvider[];
  scope: MatchScope;
  checkLengths: boolean;
  save: SaveOptions | null;
}): SearchRequest {
  const kept = choices.filter((c) => !c.skipped);
  const rows: SearchRequest["rows"] = [];
  for (const c of kept) {
    for (const f of c.videos) {
      for (const language of wanted) {
        if (scope === "missing" && kindsFor(f, language).real) continue;
        rows.push({
          key: `${f.path}\0${language}`,
          title_key: c.key,
          video_path: f.path,
          language,
          season: f.season,
          episode: f.episode,
        });
      }
    }
  }
  return {
    path: folder,
    providers: sources,
    languages: wanted,
    scope,
    check_lengths: checkLengths,
    save,
    titles: kept.map((c) => ({ key: c.key, identity: c.identity, certain: identityCertain(c) })),
    rows,
  };
}

const flagged = (l: LengthResult | undefined) =>
  !!l && "length" in l && (l.length === "short" || l.length === "long");

/** The status the Matches view shows for a row's state, candidates and length. */
export function statusFor(
  state: SearchRowResult["state"] | "has_real",
  candidates: unknown[],
  length: LengthResult | undefined,
  machineKind: "generated" | "translated" | null,
  ended = false,
): MatchStatus {
  if (state === "has_real") return "has_real";
  if (state === "pending") return ended ? "failed" : "checking";
  if (state === "failed") return "failed";
  if (candidates.length === 0) return "none";
  if (flagged(length)) return "flagged";
  return machineKind ? "replaces_machine" : "ready";
}

/** The server's length result as the page's. */
function lengthResultOf(l: SearchRowResult["length"]): LengthResult | undefined {
  if (!l) return undefined;
  if ("error" in l) return { error: l.error };
  return { length: l.verdict, last: l.last, videoDuration: l.video_duration };
}

/**
 * The Matches view's rows, rebuilt from a search job's settings and the folder scan: one row
 * per searched result, plus a "has a real subtitle" cell for a wanted language the job did not
 * search on a video it did. `ended` is true once the job has stopped, so a row it never got to
 * reads as failed ("Not searched") instead of searching forever.
 */
export function matchRowsFromResults(
  settings: SearchSettings,
  files: ScanFile[],
  ended: boolean,
): MatchRowState[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const rows: MatchRowState[] = [];
  const firstOf = new Map<string, SearchRowResult>();
  const searched = new Set<string>();
  for (const [key, r] of Object.entries(settings.results)) {
    const file = byPath.get(r.video_path);
    const kinds = file
      ? kindsFor(file, r.language)
      : { real: false, generated: false, translated: false };
    const machineKind = kinds.generated ? "generated" : kinds.translated ? "translated" : null;
    const length = lengthResultOf(r.length);
    const errors =
      r.state === "pending" && ended
        ? [{ provider: "search", message: "Not searched" }]
        : r.errors.map((e) => ({ provider: e.provider, message: e.message }));
    rows.push({
      key,
      video: r.video_path,
      filename: file?.filename ?? baseName(r.video_path),
      title: r.title_key,
      season: r.season,
      episode: r.episode,
      language: r.language,
      status: statusFor(r.state, r.candidates, length, machineKind, ended),
      candidate: r.candidates[0],
      candidates: r.candidates,
      lengthResult: length,
      machineKind,
      hasReal: kinds.real,
      errors,
      outcome: r.outcome,
      reason: r.reason,
      detail: r.detail,
    });
    if (!firstOf.has(r.video_path)) firstOf.set(r.video_path, r);
    searched.add(`${r.video_path}\0${r.language}`);
  }
  for (const [video, first] of firstOf) {
    const file = byPath.get(video);
    if (!file) continue;
    for (const language of settings.languages) {
      if (searched.has(`${video}\0${language}`) || !kindsFor(file, language).real) continue;
      rows.push({
        key: `${video}\0${language}`,
        video,
        filename: file.filename,
        title: first.title_key,
        season: first.season,
        episode: first.episode,
        language,
        status: "has_real",
        candidates: [],
        machineKind: null,
        hasReal: true,
        errors: [],
      });
    }
  }
  return rows;
}
