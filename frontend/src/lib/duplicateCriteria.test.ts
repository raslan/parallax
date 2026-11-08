import { describe, expect, it } from "vitest";
import {
  CRITERIA_KEY,
  audioCriteriaReachFurther,
  audioDialsStale,
  criteriaReachFurther,
  defaultCriteria,
  ignoreLiveStream,
  loadCriteria,
  measuredAudioDials,
} from "./duplicateCriteria";
import { DEFAULT_AUDIO_CRITERIA } from "@/types/audioDuplicate";
import type { Job } from "@/types/job";

const store = (value: string | null) => ({
  getItem: (key: string) => (key === CRITERIA_KEY ? value : null),
});

describe("loadCriteria", () => {
  it("gives the defaults when nothing was saved", () => {
    expect(loadCriteria(store(null))).toEqual(defaultCriteria());
  });

  it("lays saved criteria over the defaults, so a field added later gets its default", () => {
    // Criteria saved before the shared-audio dials existed.
    const { audio_similarity: _a, audio_min_stretch: _b, ...old } = defaultCriteria();
    const saved = { ...old, use_size: false, duration_tolerance: 5 };

    const loaded = loadCriteria(store(JSON.stringify(saved)));

    expect(loaded.use_size).toBe(false);
    expect(loaded.duration_tolerance).toBe(5);
    expect(loaded.audio_similarity).toBe(0.75);
    expect(loaded.audio_min_stretch).toBe(10);
  });

  it("falls back to the defaults for unreadable saved data", () => {
    expect(loadCriteria(store("{not json"))).toEqual(defaultCriteria());
  });

  it("does not let a saved value that is not an object break loading", () => {
    expect(loadCriteria(store("5"))).toEqual(defaultCriteria());
    expect(loadCriteria(store("null"))).toEqual(defaultCriteria());
  });
});

describe("criteriaReachFurther (video)", () => {
  const last = { ...defaultCriteria(), use_size: false, use_duration: true };

  it("is false when nothing changed", () => {
    expect(criteriaReachFurther(last, last)).toBe(false);
  });

  it.each([
    ["a tolerance loosened", { duration_tolerance: last.duration_tolerance + 1 }],
    ["a signal switched on", { use_byte_hash: true }],
    ["more pHash frames", { phash_frames: 32 }],
    ["pHash mode changed", { phash_mode: "all_frames" as const }],
    ["a free criterion switched off", { use_duration: false }],
    ["a lower filename threshold", { filename_threshold: 0.1 }],
    ["shared audio switched on", { use_audio: true }],
  ])("is true when %s", (_name, change) => {
    expect(criteriaReachFurther({ ...last, ...change }, last)).toBe(true);
  });

  it("is false when a criterion gets stricter", () => {
    expect(criteriaReachFurther({ ...last, duration_tolerance: 0.5, use_size: true }, last)).toBe(
      false,
    );
  });

  it("does not look at the two shared-audio sliders (the dials have their own check)", () => {
    const withAudio = { ...last, use_audio: true };
    expect(criteriaReachFurther({ ...withAudio, audio_similarity: 0.9 }, withAudio)).toBe(false);
  });
});

describe("audioCriteriaReachFurther", () => {
  const last = { ...DEFAULT_AUDIO_CRITERIA, use_duration: true };

  it("is true for a looser tolerance, a criterion switched off or shared audio switched on", () => {
    expect(audioCriteriaReachFurther({ ...last, duration_tolerance: 9 }, last)).toBe(true);
    expect(audioCriteriaReachFurther({ ...last, use_duration: false }, last)).toBe(true);
    expect(
      audioCriteriaReachFurther({ ...last, use_audio: true }, { ...last, use_audio: false }),
    ).toBe(true);
  });

  it("is false when nothing changed or it got stricter", () => {
    expect(audioCriteriaReachFurther(last, last)).toBe(false);
    expect(audioCriteriaReachFurther({ ...last, use_size: true }, last)).toBe(false);
  });
});

function job(over: Partial<Job>): Job {
  return {
    id: 1,
    type: "duplicates",
    status: "completed",
    library_id: 3,
    progress: 100,
    total_files: 0,
    processed_files: 0,
    current_file: null,
    error: null,
    settings: JSON.stringify({ audio_similarity: 0.7, audio_min_stretch: 12 }),
    created_at: "",
    started_at: null,
    finished_at: null,
    ...over,
  };
}

describe("measuredAudioDials", () => {
  it("reads the dials the latest finished run of this library recorded", () => {
    const jobs = [
      job({ id: 1, settings: JSON.stringify({ audio_similarity: 0.9, audio_min_stretch: 30 }) }),
      job({ id: 5 }),
    ];
    expect(measuredAudioDials(jobs, "duplicates", 3)).toEqual({
      audio_similarity: 0.7,
      audio_min_stretch: 12,
    });
  });

  it("skips other libraries, other job types and runs that did not finish", () => {
    const jobs = [
      job({ id: 4, library_id: 9 }),
      job({ id: 5, type: "audio_duplicates" }),
      job({ id: 6, status: "failed" }),
      job({ id: 7, status: "running" }),
      job({ id: 8, status: "cancelled" }),
    ];
    expect(measuredAudioDials(jobs, "duplicates", 3)).toBeNull();
  });

  it("skips a later run with shared audio off, which measured and cleared nothing", () => {
    const jobs = [job({ id: 2 }), job({ id: 9, settings: null })];
    expect(measuredAudioDials(jobs, "duplicates", 3)).toEqual({
      audio_similarity: 0.7,
      audio_min_stretch: 12,
    });
  });

  it("ignores settings it cannot read", () => {
    expect(measuredAudioDials([job({ settings: "{nope" })], "duplicates", 3)).toBeNull();
    expect(measuredAudioDials([job({ settings: "[1]" })], "duplicates", 3)).toBeNull();
    expect(
      measuredAudioDials(
        [job({ settings: JSON.stringify({ audio_similarity: "high" }) })],
        "duplicates",
        3,
      ),
    ).toBeNull();
  });

  it("is null for no library or no jobs", () => {
    expect(measuredAudioDials([], "duplicates", 3)).toBeNull();
    expect(measuredAudioDials([job({})], "duplicates", null)).toBeNull();
  });
});

describe("audioDialsStale", () => {
  const on = { use_audio: true, audio_similarity: 0.75, audio_min_stretch: 10 };
  const measured = { audio_similarity: 0.75, audio_min_stretch: 10 };

  it("is false while the sliders match what was measured", () => {
    expect(audioDialsStale(on, measured, null)).toBe(false);
  });

  it("is true when either slider moved, in either direction", () => {
    expect(audioDialsStale({ ...on, audio_similarity: 0.9 }, measured, null)).toBe(true); // stricter
    expect(audioDialsStale({ ...on, audio_similarity: 0.65 }, measured, null)).toBe(true); // looser
    expect(audioDialsStale({ ...on, audio_min_stretch: 30 }, measured, null)).toBe(true);
    expect(audioDialsStale({ ...on, audio_min_stretch: 0 }, measured, null)).toBe(true);
  });

  it("is false when shared audio is off, whatever the sliders say", () => {
    expect(
      audioDialsStale({ ...on, use_audio: false, audio_similarity: 0.9 }, measured, null),
    ).toBe(false);
  });

  it("uses the server's record over the last run's criteria", () => {
    const last = { use_audio: true, audio_similarity: 0.9, audio_min_stretch: 10 };
    expect(audioDialsStale(on, measured, last)).toBe(false);
  });

  it("falls back to what this session's last run was sent with", () => {
    const last = { use_audio: true, audio_similarity: 0.9, audio_min_stretch: 10 };
    expect(audioDialsStale(on, null, last)).toBe(true);
    expect(audioDialsStale({ ...on, audio_similarity: 0.9 }, null, last)).toBe(false);
  });

  it("has nothing to compare against when no run measured it", () => {
    expect(audioDialsStale(on, null, null)).toBe(false);
    // A last run with shared audio off measured nothing.
    expect(audioDialsStale(on, null, { ...on, use_audio: false, audio_similarity: 0.9 })).toBe(
      false,
    );
  });
});

describe("ignoreLiveStream", () => {
  it("ignores the stream while the page's own job runs", () => {
    expect(ignoreLiveStream(true, 0, 1_000)).toBe(true);
  });

  it("keeps ignoring it until the quiet window after the job has passed", () => {
    expect(ignoreLiveStream(false, 7_000, 6_999)).toBe(true);
    expect(ignoreLiveStream(false, 7_000, 7_000)).toBe(false);
  });

  it("reports a change when no job ran lately", () => {
    expect(ignoreLiveStream(false, 0, 1_000)).toBe(false);
  });
});
