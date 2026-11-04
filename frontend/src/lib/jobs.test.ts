import { describe, expect, it } from "vitest";
import { jobLabel, newlyCompleted } from "./jobs";
import type { Job } from "@/types/job";

function job(p: Partial<Job>): Job {
  return {
    id: 1,
    type: "compress",
    status: "completed",
    library_id: null,
    progress: 100,
    total_files: 0,
    processed_files: 0,
    current_file: null,
    error: null,
    settings: null,
    created_at: "",
    started_at: null,
    finished_at: null,
    ...p,
  };
}

describe("jobLabel", () => {
  it("maps known types and falls back to the raw type", () => {
    expect(jobLabel("audio_toolbox")).toBe("Audio Toolbox");
    expect(jobLabel("something_new")).toBe("something_new");
  });

  it("labels image upscale jobs", () => {
    expect(jobLabel("image_upscale")).toBe("Image Upscale");
  });
});

describe("newlyCompleted", () => {
  it("returns jobs that were running and are now completed", () => {
    const prev = new Map([[1, "running"]]);
    expect(newlyCompleted(prev, [job({ id: 1 })]).map((j) => j.id)).toEqual([1]);
  });

  it("also counts a pending job that completed", () => {
    const prev = new Map([[1, "pending"]]);
    expect(newlyCompleted(prev, [job({ id: 1 })])).toHaveLength(1);
  });

  it("ignores jobs not previously seen, so the first load never replays history", () => {
    expect(newlyCompleted(new Map(), [job({ id: 1 })])).toEqual([]);
  });

  it("ignores jobs that were already finished, failed or cancelled", () => {
    const prev = new Map([
      [1, "completed"],
      [2, "running"],
      [3, "running"],
    ]);
    const jobs = [
      job({ id: 1 }),
      job({ id: 2, status: "failed" }),
      job({ id: 3, status: "cancelled" }),
    ];
    expect(newlyCompleted(prev, jobs)).toEqual([]);
  });

  it("stays quiet for background thumbnail jobs", () => {
    const prev = new Map([[1, "running"]]);
    expect(newlyCompleted(prev, [job({ id: 1, type: "thumbnail_warm" })])).toEqual([]);
  });
});
