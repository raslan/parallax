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
  libraries: () => ["libraries"] as const,
  libraryStats: () => ["libraries", "stats"] as const,
  libraryLeftovers: (id: number) => ["libraries", id, "leftovers"] as const,
  libraryBrowse: (id: number, path = "", sortBy = "", sortDir = "") =>
    ["libraries", id, "browse", path, sortBy, sortDir] as const,

  imageLibraries: () => ["image-libraries"] as const,
  imageLibraryLeftovers: (id: number) => ["image-libraries", id, "leftovers"] as const,

  files: (params?: unknown) =>
    params === undefined ? (["files"] as const) : (["files", params] as const),

  images: (libraryId: number, params?: unknown) =>
    params === undefined
      ? (["images", libraryId] as const)
      : (["images", libraryId, params] as const),
  imageQuarantined: (libraryId: number) => ["images", libraryId, "quarantined"] as const,
  imageDuplicates: (libraryId: number, params?: unknown) =>
    params === undefined
      ? (["images", libraryId, "duplicates"] as const)
      : (["images", libraryId, "duplicates", params] as const),

  jobs: () => ["jobs"] as const,
  job: (id: number) => ["jobs", id] as const,
  jobLogs: (id: number) => ["jobs", id, "logs"] as const,

  duplicates: (libraryId: number, params?: unknown) =>
    params === undefined
      ? (["duplicates", libraryId] as const)
      : (["duplicates", libraryId, params] as const),

  cleanupFiles: (libraryId: number) => ["cleanup", libraryId] as const,

  originals: (libraryId: number) => ["originals", libraryId] as const,

  downloads: () => ["downloads"] as const,

  settings: () => ["settings"] as const,

  models: () => ["models"] as const,
  modelActiveDownload: () => ["models", "active-download"] as const,

  ytdlpInfo: () => ["ytdlp", "info"] as const,

  compressCodecs: () => ["compress", "codecs"] as const,
  compressFiles: (libraryId: number) => ["compress", "files", libraryId] as const,

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
