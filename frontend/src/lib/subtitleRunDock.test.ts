import { describe, expect, it } from "vitest";
import {
  defaultRunOptions,
  isClean,
  mergeEntries,
  parseRunJob,
  runEntries,
  runItems,
} from "./subtitleRunDock";
import type { Candidate, PlanRowState } from "@/types/subtitle";
import type { Job } from "@/types/job";

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: `Show.S01E01.${id}`,
  score: 1,
  hearing_impaired: false,
});

const row = (extra: Partial<PlanRowState> = {}): PlanRowState => ({
  key: "a|en",
  video: "/tv/a.mkv",
  filename: "a.mkv",
  title: "tv:a",
  season: 1,
  episode: 1,
  language: "en",
  status: "ready",
  candidate: cand("x"),
  candidates: [cand("x")],
  machineKind: null,
  errors: [],
  ...extra,
});

const job = (settings: object, status = "running"): Job => ({
  id: 7,
  type: "subtitle_download",
  status,
  library_id: null,
  progress: 0,
  total_files: 2,
  processed_files: 0,
  current_file: null,
  error: null,
  settings: JSON.stringify(settings),
  created_at: "",
  started_at: null,
  finished_at: null,
});

describe("defaultRunOptions", () => {
  it("starts with both tickboxes off and the Settings engine", () => {
    expect(defaultRunOptions("ffsubsync")).toEqual({
      keepExisting: false,
      syncAfter: false,
      engine: "ffsubsync",
    });
  });

  it("falls back to alass for an unknown or missing engine", () => {
    expect(defaultRunOptions("").engine).toBe("alass");
    expect(defaultRunOptions("whisper").engine).toBe("alass");
  });
});

describe("isClean", () => {
  it("takes ready and replaces-machine rows with a candidate, never flagged ones", () => {
    expect(isClean(row())).toBe(true);
    expect(isClean(row({ status: "replaces_machine" }))).toBe(true);
    expect(isClean(row({ status: "flagged" }))).toBe(false);
    expect(isClean(row({ status: "has_real" }))).toBe(false);
    expect(isClean(row({ status: "ready", candidate: undefined }))).toBe(false);
  });
});

describe("runItems", () => {
  it("sends only approved rows, marking a needs-sync verdict", () => {
    const items = runItems([
      row({ key: "1", video: "/tv/1.mkv", verdict: "use" }),
      row({ key: "2", video: "/tv/2.mkv", verdict: "use_and_sync" }),
      row({ key: "3", video: "/tv/3.mkv", verdict: "skip" }),
      row({ key: "4", video: "/tv/4.mkv" }),
    ]);
    expect(items).toEqual([
      {
        video_path: "/tv/1.mkv",
        language: "en",
        provider: "subf2m",
        subtitle_id: "x",
        sync: false,
      },
      { video_path: "/tv/2.mkv", language: "en", provider: "subf2m", subtitle_id: "x", sync: true },
    ]);
  });
});

describe("run entries", () => {
  const items = [
    { video_path: "/tv/1.mkv", language: "en", provider: "subf2m", subtitle_id: "a", sync: false },
    { video_path: "/tv/2.mkv", language: "en", provider: "subf2m", subtitle_id: "b", sync: false },
  ];

  it("reads the plan and the results stored on the job", () => {
    const parsed = parseRunJob(
      job({
        path: "/tv",
        items,
        keep_existing: true,
        sync_after: false,
        engine: null,
        results: [{ video_path: "/tv/1.mkv", language: "en", status: "failed", error: "404" }],
      }),
    );
    expect(parsed?.path).toBe("/tv");
    expect(parsed?.keepExisting).toBe(true);
    const entries = runEntries(parsed!, false);
    expect(entries.map((e) => e.state)).toEqual(["failed", "waiting"]);
    expect(entries[0]?.result?.error).toBe("404");
  });

  it("counts items without a result as skipped once the job has ended", () => {
    const parsed = parseRunJob(job({ path: "/tv", items, results: [] }, "cancelled"))!;
    expect(runEntries(parsed, true).map((e) => e.state)).toEqual(["skipped", "skipped"]);
  });

  it("returns null for a job without a readable plan", () => {
    expect(parseRunJob(undefined)).toBeNull();
    expect(parseRunJob({ ...job({}), settings: "nope" })).toBeNull();
  });

  it("lets a retry's entry replace the earlier one and keeps the rest", () => {
    const parsed = parseRunJob(
      job({
        path: "/tv",
        items,
        results: [
          { video_path: "/tv/1.mkv", language: "en", status: "failed" },
          { video_path: "/tv/2.mkv", language: "en", status: "saved" },
        ],
      }),
    )!;
    const earlier = runEntries(parsed, true);
    const retry = parseRunJob(job({ path: "/tv", items: [items[0]], results: [] }))!;
    const merged = mergeEntries(earlier, runEntries(retry, false));
    expect(merged.map((e) => `${e.item.video_path}:${e.state}`)).toEqual([
      "/tv/1.mkv:waiting",
      "/tv/2.mkv:saved",
    ]);
  });
});
