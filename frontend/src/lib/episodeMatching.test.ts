import { describe, it, expect } from "vitest";
import {
  buildInitialAssignments,
  poolFiles,
  placeFile,
  slotKey,
  distinctSeasons,
  type FileGuess,
} from "./episodeMatching";

const guess = (file_path: string, season: number | null, episode: number | null): FileGuess => ({
  file_path,
  season,
  episode,
});

describe("buildInitialAssignments", () => {
  const slots = new Set(["1:1", "1:2", "1:3"]);

  it("places a file whose guess matches an open slot", () => {
    const a = buildInitialAssignments(["a.mkv"], [guess("a.mkv", 1, 2)], slots);
    expect(a).toEqual({ "1:2": "a.mkv" });
  });

  it("first match wins — a later duplicate guess does not overwrite", () => {
    const a = buildInitialAssignments(
      ["a.mkv", "b.mkv"],
      [guess("a.mkv", 1, 1), guess("b.mkv", 1, 1)],
      slots,
    );
    expect(a).toEqual({ "1:1": "a.mkv" });
  });

  it("ignores guesses with no season/episode or no matching slot", () => {
    const a = buildInitialAssignments(
      ["a.mkv", "b.mkv", "c.mkv"],
      [guess("a.mkv", null, 1), guess("b.mkv", 9, 9), guess("c.mkv", 1, 3)],
      slots,
    );
    expect(a).toEqual({ "1:3": "c.mkv" });
  });
});

describe("poolFiles", () => {
  it("returns only files not present in the assignments map", () => {
    expect(poolFiles(["a", "b", "c"], { "1:1": "b" })).toEqual(["a", "c"]);
  });
});

describe("placeFile", () => {
  it("moves a file to a new slot, clearing its previous slot", () => {
    const next = placeFile({ "1:1": "a", "1:2": "b" }, "a", "1:3");
    expect(next).toEqual({ "1:2": "b", "1:3": "a" });
  });

  it("placing to the pool sentinel just removes the file", () => {
    const next = placeFile({ "1:1": "a", "1:2": "b" }, "a", "__pool__");
    expect(next).toEqual({ "1:2": "b" });
  });
});

describe("helpers", () => {
  it("slotKey formats season:episode", () => {
    expect(slotKey(2, 7)).toBe("2:7");
  });
  it("distinctSeasons dedupes and sorts, skipping nulls", () => {
    expect(
      distinctSeasons([guess("a", 2, 1), guess("b", 1, 1), guess("c", null, 1), guess("d", 2, 2)]),
    ).toEqual([1, 2]);
  });
});
