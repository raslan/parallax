import { BASE, req } from "./client";
import type {
  ActiveWork,
  Identity,
  LengthInfo,
  ParsedPaste,
  PreviewInfo,
  ReleaseTokens,
  RunItem,
  SearchResult,
  SubtitleCandidate,
  ScanFile,
  SubtitleFileInfo,
  SubtitleProvider,
  SubtitleTrack,
  TidyMode,
  TitleGroup,
  TranslateSource,
  UnmatchedSubtitle,
  YtsTitle,
} from "@/types/subtitle";

export const subtitlesApi = {
  scan: (path: string) =>
    req<ScanFile[]>("/subtitles/scan", { method: "POST", body: JSON.stringify({ path }) }),

  download: (path: string, languages?: string[]) =>
    req<{ job_id: number }>("/subtitles/download", {
      method: "POST",
      body: JSON.stringify({ path, languages }),
    }),

  searchFile: (
    file_path: string,
    languages?: string[],
    opts?: {
      query?: string;
      year?: number;
      media_type?: string;
      season?: number;
      episode?: number;
      provider?: string;
    },
  ) =>
    req<SubtitleCandidate[]>("/subtitles/search-file", {
      method: "POST",
      body: JSON.stringify({ file_path, languages, ...opts }),
    }),

  downloadOne: (file_path: string, provider: string, subtitle_id: string, language: string) =>
    req<{ ok: boolean }>("/subtitles/download-one", {
      method: "POST",
      body: JSON.stringify({ file_path, provider, subtitle_id, language }),
    }),

  streamUrl: (path: string) => `${BASE}/subtitles/stream?path=${encodeURIComponent(path)}`,
  vttUrl: (path: string) => `${BASE}/subtitles/vtt?path=${encodeURIComponent(path)}`,
  tracks: (path: string) =>
    req<SubtitleTrack[]>(`/subtitles/tracks?path=${encodeURIComponent(path)}`),
  tracksUrl: (path: string) => `${BASE}/subtitles/tracks?path=${encodeURIComponent(path)}`,

  deleteSubtitle: (file_path: string, language: string, machine = false) =>
    req<{ ok: boolean }>(
      `/subtitles/file?file_path=${encodeURIComponent(file_path)}&language=${encodeURIComponent(language)}${machine ? "&machine=true" : ""}`,
      { method: "DELETE" },
    ),

  /** Name one subtitle with `subtitle_path` (else every track of `language`, or all). */
  syncFile: (
    file_path: string,
    language?: string,
    opts?: { subtitle_path?: string; engine?: "alass" | "ffsubsync" },
  ) =>
    req<{ job_id: number }>("/subtitles/sync-file", {
      method: "POST",
      body: JSON.stringify({ file_path, language, ...opts }),
    }),

  translateSources: (path: string) =>
    req<TranslateSource[]>(`/subtitles/translate-sources?path=${encodeURIComponent(path)}`),

  /** `keep_existing` writes `translated-2` beside the earlier file; `path` is the folder the work was started from. */
  translate: (
    file_paths: string[],
    language: string,
    source?: string,
    opts?: { keep_existing?: boolean; path?: string },
  ) =>
    req<{ job_id: number }>("/subtitles/translate", {
      method: "POST",
      body: JSON.stringify({ file_paths, language, source, ...opts }),
    }),

  /** Uses the speech model chosen in Settings → Subtitles unless `model` (small | medium) is given. */
  generate: (
    file_paths: string[],
    model?: string,
    opts?: { keep_existing?: boolean; path?: string },
  ) =>
    req<{ job_id: number }>("/subtitles/generate", {
      method: "POST",
      body: JSON.stringify({ file_paths, model, ...opts }),
    }),

  // ---- the redesigned page ----

  /** Suggested title groups for the videos in a folder. */
  groups: (path: string) =>
    req<TitleGroup[]>("/subtitles/groups", { method: "POST", body: JSON.stringify({ path }) }),

  /** Every subtitle file of one video, from disk. */
  files: (video_path: string) =>
    req<SubtitleFileInfo[]>("/subtitles/files", {
      method: "POST",
      body: JSON.stringify({ video_path }),
    }),

  /** Subtitle files under a folder that no video claims. */
  unmatched: (path: string) =>
    req<UnmatchedSubtitle[]>("/subtitles/unmatched", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  /** Film cards from the YTS title search. */
  yts: (query: string) =>
    req<YtsTitle[]>("/subtitles/identity/yts", { method: "POST", body: JSON.stringify({ query }) }),

  /** Resolve a pasted IMDB id / link or subtitle-site link; rejects (422) when unreadable. */
  parsePasted: (text: string) =>
    req<ParsedPaste>("/subtitles/identity/parse", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  /** Read-only search of the chosen sources for one video. */
  search: (body: {
    video_path: string;
    identity: Identity;
    languages: string[];
    providers: SubtitleProvider[];
    season?: number;
    episode?: number;
  }) => req<SearchResult>("/subtitles/search", { method: "POST", body: JSON.stringify(body) }),

  /** Download a candidate to a temporary place and describe it. Nothing is written beside the video. */
  preview: (body: {
    video_path: string;
    provider: SubtitleProvider;
    subtitle_id: string;
    language: string;
  }) => req<PreviewInfo>("/subtitles/preview", { method: "POST", body: JSON.stringify(body) }),

  previewVttUrl: (preview_id: string) =>
    `${BASE}/subtitles/preview/${encodeURIComponent(preview_id)}.vtt`,

  releaseTokens: (release: string, video_name: string) =>
    req<ReleaseTokens>("/subtitles/release-tokens", {
      method: "POST",
      body: JSON.stringify({ release, video_name }),
    }),

  /** Queue the approved items as one job. */
  run: (body: {
    path: string;
    items: RunItem[];
    keep_existing?: boolean;
    sync_after?: boolean;
    engine?: "alass" | "ffsubsync";
  }) => req<{ job_id: number }>("/subtitles/run", { method: "POST", body: JSON.stringify(body) }),

  /** Running and waiting subtitle jobs, grouped by the folder they were started from. */
  active: () => req<ActiveWork[]>("/subtitles/active"),

  /** A video path that is not an existing video maps to null. */
  checkLengths: (video_paths: string[]) =>
    req<Record<string, LengthInfo | null>>("/subtitles/check-lengths", {
      method: "POST",
      body: JSON.stringify({ video_paths }),
    }),

  rename: (video_path: string, subtitle_path: string, new_name: string) =>
    req<{ path: string; outside_view: boolean }>("/subtitles/rename", {
      method: "POST",
      body: JSON.stringify({ video_path, subtitle_path, new_name }),
    }),

  makeMain: (video_path: string, subtitle_path: string) =>
    req<{ main: string; other: string | null }>("/subtitles/make-main", {
      method: "POST",
      body: JSON.stringify({ video_path, subtitle_path }),
    }),

  remove: (video_path: string, subtitle_paths: string[]) =>
    req<{ deleted: number }>("/subtitles/delete", {
      method: "POST",
      body: JSON.stringify({ video_path, subtitle_paths }),
    }),

  tidy: (video_paths: string[], what: TidyMode) =>
    req<{ deleted: number }>("/subtitles/tidy", {
      method: "POST",
      body: JSON.stringify({ video_paths, what }),
    }),

  restoreOriginal: (video_path: string, subtitle_path: string) =>
    req<{ ok: boolean }>("/subtitles/restore-original", {
      method: "POST",
      body: JSON.stringify({ video_path, subtitle_path }),
    }),

  /** One job that syncs every subtitle of each video; `path` is the folder the work was started from. */
  syncFiles: (video_paths: string[], opts?: { path?: string; engine?: "alass" | "ffsubsync" }) =>
    req<{ job_id: number }>("/subtitles/sync-files", {
      method: "POST",
      body: JSON.stringify({ video_paths, ...opts }),
    }),

  syncBulk: (path: string) =>
    req<{ job_id: number }>("/subtitles/sync-bulk", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
};
