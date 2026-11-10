import { describe, expect, it, vi } from "vitest";
import {
  TAG_COLUMNS_KEY,
  describeText,
  loadTagColumns,
  mixedValue,
  saveTagColumns,
} from "./organizeTags";

const storageOf = (value: string | null) => ({ getItem: vi.fn(() => value) });

describe("loadTagColumns", () => {
  it("shows no tag columns until the user picks some", () => {
    expect(loadTagColumns(storageOf(null))).toEqual([]);
  });

  it("keeps known ids in the saved order and drops unknown or repeated ones", () => {
    expect(loadTagColumns(storageOf('["artist","bogus","title","artist"]'))).toEqual([
      "artist",
      "title",
    ]);
  });

  it("an empty saved list means no columns, not the default", () => {
    expect(loadTagColumns(storageOf("[]"))).toEqual([]);
  });

  it("falls back on unreadable data or a storage that throws", () => {
    expect(loadTagColumns(storageOf("{not json"))).toEqual([]);
    expect(loadTagColumns(storageOf('{"a":1}'))).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadTagColumns(throwing)).toEqual([]);
  });
});

describe("saveTagColumns", () => {
  it("writes the list under the shared key", () => {
    const setItem = vi.fn();
    saveTagColumns({ setItem }, ["genre", "date"]);
    expect(setItem).toHaveBeenCalledWith(TAG_COLUMNS_KEY, '["genre","date"]');
  });

  it("never throws when the storage does", () => {
    const setItem = () => {
      throw new Error("quota");
    };
    expect(() => saveTagColumns({ setItem }, ["title"])).not.toThrow();
  });
});

describe("describeText", () => {
  it("counts characters and hashtags", () => {
    expect(describeText("#a #b\n#c text")).toEqual({ chars: 13, hashtags: 3 });
  });

  it("does not count a # inside a word (C#, a#b) or a lone #", () => {
    expect(describeText("learn C# and a#b # alone")).toEqual({ chars: 24, hashtags: 0 });
  });

  it("counts non-latin hashtags and counts characters, not UTF-16 units", () => {
    expect(describeText("#아이브 #에스파 😀")).toEqual({ chars: 11, hashtags: 2 });
  });

  it("is zero for empty text", () => {
    expect(describeText("")).toEqual({ chars: 0, hashtags: 0 });
  });
});

describe("mixedValue", () => {
  it("one shared value", () => {
    expect(mixedValue(["x", "x"])).toEqual({ kind: "same", value: "x" });
  });

  it("different values, with the files that have none counted apart", () => {
    expect(mixedValue(["x", undefined, "y"])).toEqual({ kind: "mixed", distinct: 2, empties: 1 });
  });

  it("a value on some files and none on the others is mixed, not shared", () => {
    expect(mixedValue(["x", undefined])).toEqual({ kind: "mixed", distinct: 1, empties: 1 });
  });

  it("nothing anywhere is empty", () => {
    expect(mixedValue([undefined, undefined])).toEqual({ kind: "empty" });
    expect(mixedValue([])).toEqual({ kind: "empty" });
  });
});
