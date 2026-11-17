interface SubtitleCandidate {
  subtitle_id: string;
  provider: string;
  language: string;
  release: string;
  score: number;
  hearing_impaired: boolean;
}

/** Who a video is: sent with a search. `imdb_id` / `tmdb_id` are optional upgrades. */
export interface Identity {
  title: string;
  year: number | null;
  type: "movie" | "tv";
  imdb_id?: string;
  tmdb_id?: number;
  /** A pasted Subf2m page (`/subtitles/<slug>`): searched directly, not by title. */
  subf2m_path?: string;
}

export type SubtitleKind = "real" | "hearing_impaired" | "generated" | "translated" | "original";

/** One subtitle file of a video, as it is on disk (`directory` is relative to the video's folder). */
export interface SubtitleFileInfo {
  path: string;
  name: string;
  language: string;
  label: string | null;
  kind: SubtitleKind;
  size: number;
  directory: string;
}

/** One video of a folder scan, with every subtitle file it has on disk. */
export interface ScanFile {
  path: string;
  filename: string;
  relative_dir: string;
  title: string;
  season: number | null;
  episode: number | null;
  year: number | null;
  media_type: string;
  subtitles: SubtitleFileInfo[];
}

/** A subtitle file in the folder that no video claims. `language` is null when unreadable. */
export interface UnmatchedSubtitle {
  path: string;
  name: string;
  directory: string;
  language: string | null;
}

export interface TitleGroup {
  key: string;
  title: string;
  year: number | null;
  type: "movie" | "tv";
  files: string[];
  layout_clean: boolean;
  needs_choice: boolean;
}

/** A film card from the YTS title search. */
export interface YtsTitle {
  title: string;
  year: number | null;
  imdb_id: string;
  poster_url: string | null;
}

/** What a pasted IMDB id / link or subtitle-site link resolved to (exactly one key). */
export interface ParsedPaste {
  imdb_id?: string;
  subf2m_path?: string;
}

export type SubtitleProvider = "subf2m" | "yts";

export interface Candidate extends SubtitleCandidate {
  provider: SubtitleProvider;
}

export interface SearchResult {
  candidates: Candidate[];
  /** A source that failed or does not apply; the other sources' candidates are still returned. */
  errors: { provider: string; message: string }[];
}

type LengthVerdict = "ok" | "short" | "long" | "unknown";

export interface PreviewInfo {
  preview_id: string;
  cues: number;
  first: number;
  last: number;
  video_duration: number | null;
  length: LengthVerdict;
  lines: { start: number; text: string }[];
}

export interface RunItem {
  video_path: string;
  language: string;
  provider: SubtitleProvider;
  subtitle_id: string;
  sync: boolean;
}

/** A title group in the Titles step of Find subtitles: the identity to search as, or skipped. */
export interface TitleChoice {
  key: string;
  group: TitleGroup;
  files: number;
  identity: Identity;
  skipped: boolean;
  /** True once the user picked an identity for this title by hand in this run. */
  confirmed?: boolean;
}

/** Which files a search covers: only languages with no real subtitle yet, or every selected one. */
export type MatchScope = "missing" | "all";

/** One title of a search: the identity the user confirmed, and the videos to search for. */
export interface MatchGroup {
  key: string;
  identity: Identity;
  files: ScanFile[];
}

type MatchStatus = "ready" | "has_real" | "replaces_machine" | "none" | "checking" | "flagged";

/** `use_and_sync` downloads the row and syncs only that file. */
export type MatchVerdict = "use" | "use_and_sync" | "skip";

/** The length check of a row's top candidate, or why it could not be read. */
export type LengthResult =
  { length: LengthVerdict; last: number; videoDuration: number | null } | { error: string };

/** One cell of the matches: a video and one wanted language. */
export interface MatchRowState {
  key: string;
  video: string;
  filename: string;
  /** The title group's key. */
  title: string;
  season: number | null;
  episode: number | null;
  language: string;
  status: MatchStatus;
  candidate?: Candidate;
  candidates: Candidate[];
  verdict?: MatchVerdict;
  lengthResult?: LengthResult;
  /** A generated or translated file of this language the download would replace (Keep existing off). */
  machineKind: "generated" | "translated" | null;
  /** The video already has a real subtitle in this language (a download would replace it with Keep existing off). */
  hasReal: boolean;
  /** Sources that failed or do not apply, for this row. */
  errors: { provider: string; message: string }[];
}

/** One item's outcome, as the run job stores it in `job.settings.results`. */
export interface RunResult {
  video_path: string;
  language: string;
  status: "saved" | "failed" | "skipped";
  path?: string;
  error?: string;
  sync_error?: string;
  cleanup_error?: string;
}

/** An item of a run with where it is: not reached yet, or its result. */
export interface RunEntry {
  item: RunItem;
  state: "waiting" | RunResult["status"];
  result: RunResult | null;
}

/** A pending or running subtitle job; `queue_position` is set only while it waits for a slot. */
export interface ActiveJob {
  id: number;
  type: string;
  status: string;
  progress: number;
  current_file: string | null;
  queue_position: number | null;
}

export interface ActiveWork {
  path: string;
  jobs: ActiveJob[];
}

/** Per wanted language: how many of the files have a real, a generated and a translated subtitle. */
export interface LanguageCoverage {
  real: number;
  generated: number;
  translated: number;
  total: number;
}

export interface LengthInfo {
  duration: number | null;
  subtitles: { path: string; last_cue: number | null; length: LengthVerdict }[];
}

/** One token of a release name compared with the video's file name; `match` is null when either side lacks it. */
export interface ReleaseToken {
  value: string | null;
  match: boolean | null;
}
export type ReleaseTokens = Record<"resolution" | "source" | "group", ReleaseToken>;

export type TidyMode = "generated_translated" | "extra_versions" | "originals";

/** An English subtitle file the user can pick to translate. */
export interface TranslateSource {
  path: string;
  filename: string;
  machine_made: boolean;
  hearing_impaired: boolean;
}

export interface SubtitleTrack {
  label: string;
  lang: string;
  hearing_impaired?: boolean;
  machine_made?: boolean;
  url: string;
}
