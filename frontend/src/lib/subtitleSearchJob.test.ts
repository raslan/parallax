import { describe, expect, it } from "vitest";
import {
  buildSearchRequest,
  lastSearchFor,
  matchRowsFromResults,
  parseSearchSettings,
  searchSummary,
} from "./subtitleSearchJob";
import type { Job } from "@/types/job";
import type {
  Candidate,
  ScanFile,
  SearchRowResult,
  SearchSettings,
  SubtitleFileInfo,
} from "@/types/subtitle";

const cand = (id: string, kind: "episode" | "season_pack" = "episode"): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: `Show.S01E01.${id}`,
  score: 50,
  hearing_impaired: false,
  release_kind: kind,
});

const sub = (path: string, language: string, kind: SubtitleFileInfo["kind"] = "real") => ({
  path: `${path}.${language}.srt`,
  name: "x",
  language,
  label: null,
  kind,
  size: 1,
  directory: "",
});

const file = (n: number, subtitles: SubtitleFileInfo[] = []): ScanFile => ({
  path: `/tv/Show/S01E0${n}.mkv`,
  filename: `S01E0${n}.mkv`,
  relative_dir: "",
  title: "Show",
  season: 1,
  episode: n,
  year: 2016,
  media_type: "episode",
  subtitles,
});

const result = (n: number, lang = "en", extra: Partial<SearchRowResult> = {}): SearchRowResult => ({
  title_key: "tv:show",
  video_path: `/tv/Show/S01E0${n}.mkv`,
  language: lang,
  season: 1,
  episode: n,
  state: "checked",
  candidates: [cand(String(n))],
  errors: [],
  length: { last: 2900, video_duration: 3000, verdict: "ok" },
  outcome: null,
  reason: null,
  detail: null,
  saved: null,
  ...extra,
});

const keyOf = (n: number, lang = "en") => `/tv/Show/S01E0${n}.mkv\0${lang}`;

function settings(
  rows: [number, string, Partial<SearchRowResult>?][],
  extra: Partial<SearchSettings> = {},
): SearchSettings {
  return {
    path: "/tv/Show",
    providers: ["subf2m"],
    languages: ["en", "ar"],
    scope: "missing",
    check_lengths: true,
    save: null,
    titles: [
      { key: "tv:show", identity: { title: "Show", year: 2016, type: "tv" }, certain: true },
    ],
    results: Object.fromEntries(rows.map(([n, l, e]) => [keyOf(n, l), result(n, l, e)])),
    ...extra,
  };
}

const job = (
  id: number,
  type: string,
  status: string,
  s: object | null,
  extra: Partial<Job> = {},
): Job => ({
  id,
  type,
  status,
  library_id: null,
  progress: 0,
  total_files: 0,
  processed_files: 0,
  current_file: null,
  error: null,
  settings: s === null ? null : JSON.stringify(s),
  created_at: "2026-11-17T14:32:00",
  started_at: null,
  finished_at: null,
  ...extra,
});

describe("parseSearchSettings", () => {
  it("reads a search job's settings", () => {
    const s = settings([[1, "en"]]);
    expect(parseSearchSettings(job(1, "subtitle_search", "running", s))?.languages).toEqual([
      "en",
      "ar",
    ]);
  });

  it("returns null for no job, no settings, bad json or another kind of job", () => {
    expect(parseSearchSettings(null)).toBeNull();
    expect(parseSearchSettings(job(1, "subtitle_search", "running", null))).toBeNull();
    expect(
      parseSearchSettings({ ...job(1, "subtitle_search", "running", {}), settings: "{" }),
    ).toBeNull();
    expect(parseSearchSettings(job(1, "subtitle_download", "running", { path: "/x" }))).toBeNull();
    expect(parseSearchSettings(job(1, "subtitle_search", "running", { path: "/x" }))).toBeNull();
  });
});

describe("matchRowsFromResults", () => {
  const files = [file(1), file(2), file(3)];

  it("maps each state to the status the Matches view shows", () => {
    const s = settings([
      [1, "en", { state: "pending", candidates: [], length: null }],
      [2, "en", { state: "searched", candidates: [], length: null }],
      [
        3,
        "en",
        {
          state: "failed",
          candidates: [],
          errors: [{ provider: "search", message: "boom" }],
          length: null,
        },
      ],
    ]);
    const rows = matchRowsFromResults(s, files, false);
    expect(rows.map((r) => r.status)).toEqual(["checking", "none", "failed"]);
    expect(rows[2]?.errors).toEqual([{ provider: "search", message: "boom" }]);
  });

  it("is ready when the length is ok, flagged when short or long", () => {
    const s = settings([
      [1, "en"],
      [2, "en", { length: { last: 900, video_duration: 3000, verdict: "short" } }],
      [3, "en", { length: { last: 4000, video_duration: 3000, verdict: "long" } }],
    ]);
    const rows = matchRowsFromResults(s, files, false);
    expect(rows.map((r) => r.status)).toEqual(["ready", "flagged", "flagged"]);
    expect(rows[1]?.lengthResult).toEqual({ length: "short", last: 900, videoDuration: 3000 });
  });

  it("is checking, not ready, while its length check is still to come", () => {
    const s = settings([[1, "en", { state: "searched", length: null }]]);
    const [r] = matchRowsFromResults(s, files, false);
    expect(r?.status).toBe("checking");
    expect(r?.lengthResult).toBeUndefined();
    expect(r?.candidate).toBeDefined(); // it has been searched: it only awaits the check
  });

  it("is ready with no length when the search was started without the check", () => {
    const s = {
      ...settings([[1, "en", { state: "searched", length: null }]]),
      check_lengths: false,
    };
    expect(matchRowsFromResults(s, files, false)[0]?.status).toBe("ready");
  });

  it("is ready with no length once the job has ended (a cancelled search never checked it)", () => {
    const s = settings([[1, "en", { state: "searched", length: null }]]);
    expect(matchRowsFromResults(s, files, true)[0]?.status).toBe("ready");
  });

  it("shows a length error or an unknown length as 'not checked', still ready", () => {
    const s = settings([
      [1, "en", { length: { error: "Could not read the video: S01E01.mkv" } }],
      [2, "en", { length: { last: 2900, video_duration: null, verdict: "unknown" } }],
    ]);
    const rows = matchRowsFromResults(s, files, false);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]?.lengthResult).toEqual({ error: "Could not read the video: S01E01.mkv" });
    expect(rows[1]?.lengthResult).toEqual({ length: "unknown", last: 2900, videoDuration: null });
  });

  it("says a generated or translated file would be replaced", () => {
    const withMachine = file(1, [sub("/tv/Show/S01E01.mkv", "en", "generated")]);
    const rows = matchRowsFromResults(settings([[1, "en"]]), [withMachine], false);
    expect(rows[0]).toMatchObject({ status: "replaces_machine", machineKind: "generated" });
  });

  it("adds a has-real cell for a language the job did not search, for a video it did", () => {
    const real = file(1, [sub("/tv/Show/S01E01.mkv", "ar")]);
    const rows = matchRowsFromResults(settings([[1, "en"]]), [real], false);
    expect(rows.map((r) => [r.language, r.status])).toEqual([
      ["en", "ready"],
      ["ar", "has_real"],
    ]);
  });

  it("adds no cell for a language the video lacks and the job did not search", () => {
    const rows = matchRowsFromResults(settings([[1, "en"]]), [file(1)], false);
    expect(rows.map((r) => r.language)).toEqual(["en"]);
  });

  it("calls a row that was never searched failed once the job has ended", () => {
    const s = settings([[1, "en", { state: "pending", candidates: [], length: null }]]);
    const [r] = matchRowsFromResults(s, files, true);
    expect(r?.status).toBe("failed");
    expect(r?.errors).toEqual([{ provider: "search", message: "Not searched" }]);
  });

  it("carries the row's identity, season, episode, file name and automatic-save outcome", () => {
    const s = settings([[1, "en", { outcome: "left", reason: "only_season_pack", detail: null }]]);
    const [r] = matchRowsFromResults(s, files, false);
    expect(r).toMatchObject({
      key: keyOf(1),
      video: "/tv/Show/S01E01.mkv",
      filename: "S01E01.mkv",
      title: "tv:show",
      season: 1,
      episode: 1,
      outcome: "left",
      reason: "only_season_pack",
    });
  });

  it("falls back to the path's file name for a video the folder scan no longer has", () => {
    const [r] = matchRowsFromResults(settings([[9, "en"]]), [], false);
    expect(r?.filename).toBe("S01E09.mkv");
    expect(r?.hasReal).toBe(false);
  });
});

describe("lastSearchFor", () => {
  const s = (path: string) => settings([[1, "en"]], { path });

  it("is the newest search job of that folder, in any state", () => {
    const jobs = [
      job(3, "subtitle_search", "completed", s("/tv")),
      job(7, "subtitle_search", "cancelled", s("/tv")),
      job(9, "subtitle_search", "completed", s("/other")),
      job(8, "subtitle_download", "completed", { path: "/tv" }),
    ];
    expect(lastSearchFor(jobs, "/tv")?.id).toBe(7);
    expect(lastSearchFor(jobs, "/other")?.id).toBe(9);
    expect(lastSearchFor(jobs, "/none")).toBeNull();
    expect(lastSearchFor(jobs, null)).toBeNull();
  });

  it("ignores a search job with unreadable settings", () => {
    const jobs = [{ ...job(5, "subtitle_search", "completed", null) }];
    expect(lastSearchFor(jobs, "/tv")).toBeNull();
  });
});

describe("searchSummary", () => {
  it("is the server's own line for a finished job", () => {
    expect(
      searchSummary(
        job(1, "subtitle_search", "completed", null, { current_file: "42 of 48 found" }),
      ),
    ).toBe("42 of 48 found");
    expect(
      searchSummary(job(1, "subtitle_search", "failed", null, { error: "The source is down" })),
    ).toBe("failed: The source is down");
  });
});

describe("buildSearchRequest", () => {
  const withSub = (n: number, lang: string) => file(n, [sub(`/tv/Show/S01E0${n}.mkv`, lang)]);
  const choice = (
    videos: ScanFile[],
    extra: Partial<Parameters<typeof buildSearchRequest>[0]["choices"][number]> = {},
  ) => ({
    key: "tv:show",
    group: {
      key: "tv:show",
      title: "Show",
      year: 2016,
      type: "tv" as const,
      files: videos.map((v) => v.path),
      layout_clean: true,
      needs_choice: false,
    },
    files: videos.length,
    videos,
    identity: { title: "Show", year: 2016, type: "tv" as const },
    skipped: false,
    ...extra,
  });
  const base = {
    folder: "/tv/Show",
    wanted: ["en", "ar"],
    sources: ["subf2m" as const],
    scope: "missing" as const,
    checkLengths: true,
    save: null,
  };

  it("makes a row per video and wanted language that needs a search, in video order", () => {
    const req = buildSearchRequest({
      ...base,
      choices: [choice([withSub(1, "en"), file(2)])],
    });
    expect(req.rows.map((r) => [r.video_path.slice(-7), r.language])).toEqual([
      ["E01.mkv", "ar"], // English is real already
      ["E02.mkv", "en"],
      ["E02.mkv", "ar"],
    ]);
    expect(req.rows[0]).toEqual({
      key: "/tv/Show/S01E01.mkv\0ar",
      title_key: "tv:show",
      video_path: "/tv/Show/S01E01.mkv",
      language: "ar",
      season: 1,
      episode: 1,
    });
  });

  it("searches every wanted language under scope all", () => {
    const req = buildSearchRequest({
      ...base,
      scope: "all",
      choices: [choice([withSub(1, "en")])],
    });
    expect(req.rows.map((r) => r.language)).toEqual(["en", "ar"]);
  });

  it("carries the request's choices and each kept title's identity and certainty", () => {
    const req = buildSearchRequest({
      ...base,
      checkLengths: false,
      save: { keep_existing: true, sync_after: false, engine: null },
      choices: [
        choice([file(1)]),
        choice([file(2)], { key: "other", skipped: true }),
        choice([file(3)], {
          key: "guess",
          group: {
            key: "guess",
            title: "G",
            year: null,
            type: "tv",
            files: [],
            layout_clean: false,
            needs_choice: false,
          },
        }),
      ],
    });
    expect(req).toMatchObject({
      path: "/tv/Show",
      providers: ["subf2m"],
      languages: ["en", "ar"],
      scope: "missing",
      check_lengths: false,
      save: { keep_existing: true, sync_after: false, engine: null },
    });
    expect(req.titles).toEqual([
      { key: "tv:show", identity: { title: "Show", year: 2016, type: "tv" }, certain: true },
      { key: "guess", identity: { title: "Show", year: 2016, type: "tv" }, certain: false },
    ]);
    expect(req.rows.every((r) => r.title_key !== "other")).toBe(true);
  });

  it("has no rows when everything already has a real subtitle", () => {
    const req = buildSearchRequest({
      ...base,
      wanted: ["en"],
      choices: [choice([withSub(1, "en")])],
    });
    expect(req.rows).toEqual([]);
  });
});
