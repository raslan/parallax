interface SubtitleFile {
  path: string;
  filename: string;
  relative_dir: string;
  has_subtitle: boolean;
  has_any_subtitle: boolean;
  languages: Record<string, boolean>;
  /** Wanted languages for which only a machine-made (offline translation / speech-to-text) file exists. */
  machine_languages: Record<string, boolean>;
  title: string;
  season: number | null;
  episode: number | null;
  year: number | null;
  media_type: string;
}

export interface SubtitleCandidate {
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
export interface ScanFile extends SubtitleFile {
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

/** @public consumed by the new Subtitles page (Tasks 12-15); drop the tag then */
export interface Candidate extends SubtitleCandidate {
  provider: SubtitleProvider;
}

export interface SearchResult {
  candidates: Candidate[];
  /** A source that failed or does not apply; the other sources' candidates are still returned. */
  errors: { provider: string; message: string }[];
}

/** @public consumed by the new Subtitles page (Tasks 12-15); drop the tag then */
export type LengthVerdict = "ok" | "short" | "long" | "unknown";

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
/** @public consumed by the new Subtitles page (Tasks 12-15); drop the tag then */
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
