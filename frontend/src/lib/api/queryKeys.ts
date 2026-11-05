/**
 * Central registry of TanStack Query keys — one namespace per backend resource,
 * matching the `api/*.ts` split. Always build keys through `qk.*` so
 * invalidation (`queryClient.invalidateQueries({ queryKey: qk.files() })`)
 * stays consistent across pages.
 *
 * Convention: `qk.thing()` is the list/root key; `qk.thing(id)` narrows to one
 * record; extra params go in a trailing object so partial keys still match on
 * invalidation.
 */

export const qk = {
  // ── stats (durable, file-agnostic usage metrics) ──
  stats: () => ["stats"] as const,
  statsSummary: (days: number) => ["stats", "summary", days] as const,
  statsTimeseries: (bucket: string, days: number) => ["stats", "timeseries", bucket, days] as const,
  statsBreakdown: (by: string, days: number) => ["stats", "breakdown", by, days] as const,

  libraries: () => ["libraries"] as const,
  libraryStats: () => ["libraries", "stats"] as const,
  libraryLeftovers: (id: number) => ["libraries", id, "leftovers"] as const,
  libraryBrowse: (id: number, path = "", sortBy = "", sortDir = "") =>
    ["libraries", id, "browse", path, sortBy, sortDir] as const,

  imageLibraries: () => ["image-libraries"] as const,
  imageLibraryLeftovers: (id: number) => ["image-libraries", id, "leftovers"] as const,

  // ── audio ──
  audioLibraries: () => ["audio-libraries"] as const,
  audioLibraryLeftovers: (id: number) => ["audio-libraries", id, "leftovers"] as const,
  audioFiles: (libraryId: number) => ["audio-files", libraryId] as const,
  audioCompressCodecs: () => ["audio-compress", "codecs"] as const,
  audioOriginals: (libraryId?: number) =>
    libraryId === undefined
      ? (["audio-originals"] as const)
      : (["audio-originals", libraryId] as const),

  files: (params?: unknown) =>
    params === undefined ? (["files"] as const) : (["files", params] as const),

  images: (params?: unknown) =>
    params === undefined ? (["images"] as const) : (["images", params] as const),
  imageQuarantined: () => ["images", "quarantined"] as const,
  upscaleTiers: () => ["image-upscale", "tiers"] as const,
  upscaleCredits: () => ["image-upscale", "credits"] as const,
  imageDuplicates: (libraryId: number, params?: unknown) =>
    params === undefined
      ? (["image-duplicates", libraryId] as const)
      : (["image-duplicates", libraryId, params] as const),

  jobs: () => ["jobs"] as const,
  job: (id: number) => ["jobs", id] as const,
  jobLogs: (id: number) => ["jobs", id, "logs"] as const,

  duplicateFiles: (libraryId: number) => ["duplicate-files", libraryId] as const,

  cleanupFiles: (libraryId: number) => ["cleanup", libraryId] as const,

  originals: (libraryId?: number) =>
    libraryId === undefined ? (["originals"] as const) : (["originals", libraryId] as const),

  downloads: () => ["downloads"] as const,

  pruneRoot: () => ["prune", "root"] as const,
  pruneScan: () => ["prune", "scan"] as const,
  /** No path = the prefix of every folder listing (for invalidate/remove). */
  pruneFolder: (path?: string) =>
    path === undefined ? (["prune", "folder"] as const) : (["prune", "folder", path] as const),
  pruneFiles: (path?: string) =>
    path === undefined ? (["prune", "files"] as const) : (["prune", "files", path] as const),

  galleryOptions: () => ["galleries", "options"] as const,
  galleryDlInfo: () => ["gallery-dl", "info"] as const,
  galleryYtdlImpersonateTargets: () => ["gallery-dl", "ytdl-impersonate-targets"] as const,
  galleryArchive: () => ["galleries", "archive"] as const,
  galleryUrlLists: () => ["galleries", "urllists"] as const,
  galleryUrlList: (name: string) => ["galleries", "urllists", name] as const,
  galleryListTypes: (name: string) => ["galleries", "urllists", name, "types"] as const,

  settings: () => ["settings"] as const,

  models: () => ["models"] as const,
  modelActiveDownload: () => ["models", "active-download"] as const,

  ytdlpInfo: () => ["ytdlp", "info"] as const,
  ytdlpImpersonateTargets: () => ["ytdlp", "impersonate-targets"] as const,

  compressCodecs: () => ["compress", "codecs"] as const,
  compressResolutions: () => ["compress", "resolutions"] as const,
  compressFiles: (libraryId: number) => ["compress", "files", libraryId] as const,

  toolboxFiles: (libraryId: number) => ["toolbox", "files", libraryId] as const,

  spliceFiles: (libraryId: number) => ["splice", "files", libraryId] as const,
  splicePreflight: (ids: number[], referenceId: number | null, name: string, codec: string) =>
    ["splice", "preflight", ids.join(","), referenceId, name, codec] as const,

  subtitleScan: (libraryId: number, params?: unknown) =>
    params === undefined
      ? (["subtitles", "scan", libraryId] as const)
      : (["subtitles", "scan", libraryId, params] as const),
  subtitleTracks: (path: string) => ["subtitles", "tracks", path] as const,

  identifyFiles: (libraryId: number) => ["identify", "files", libraryId] as const,
  identifyEpisodes: (tmdbId: number) => ["identify", "episodes", tmdbId] as const,
  identifySeason: (tmdbId: number, season: number) =>
    ["identify", "episodes", tmdbId, season] as const,
} as const;
