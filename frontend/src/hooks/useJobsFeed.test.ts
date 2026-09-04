import { describe, it, expect } from "vitest";
import { computeAggregateProgress } from "./useJobsFeed";
import type { Job } from "@/types/job";

function job(p: Partial<Job>): Job {
  return {
    id: 1,
    type: "scan",
    status: "running",
    library_id: null,
    progress: 0,
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

describe("computeAggregateProgress", () => {
  it("returns null when no jobs are active or pending", () => {
    expect(computeAggregateProgress([job({ status: "completed" })])).toBeNull();
    expect(computeAggregateProgress([])).toBeNull();
  });

  it("returns 'pending' when jobs are queued but none running", () => {
    expect(computeAggregateProgress([job({ status: "pending" })])).toBe("pending");
  });

  it("file-weights progress across running jobs", () => {
    // 0/3000 + 5/5  ->  5 / 3005  ->  0 (rounded)
    const p = computeAggregateProgress([
      job({ id: 1, status: "running", total_files: 3000, processed_files: 0 }),
      job({ id: 2, status: "running", total_files: 5, processed_files: 5 }),
    ]);
    expect(p).toBe(0);
  });

  it("uses raw progress for jobs with no file count", () => {
    const p = computeAggregateProgress([
      job({ id: 1, status: "running", total_files: 0, progress: 40 }),
      job({ id: 2, status: "running", total_files: 0, progress: 60 }),
    ]);
    expect(p).toBe(50);
  });

  it("ignores terminal jobs in the mix", () => {
    const p = computeAggregateProgress([
      job({ id: 1, status: "running", total_files: 10, processed_files: 5 }),
      job({ id: 2, status: "completed", total_files: 100, processed_files: 100 }),
    ]);
    expect(p).toBe(50);
  });
});
