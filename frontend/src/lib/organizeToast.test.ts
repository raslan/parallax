import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));

import { toast } from "sonner";
import { REDACTED_FILE } from "@/lib/organizeRedact";
import { toastFailures, toastStageResult } from "./organizeToast";

const fail = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ path: `/r/dir/f${i}.txt`, error: "exists" }));

beforeEach(() => vi.clearAllMocks());

describe("toastFailures", () => {
  it("shows nothing when nothing failed", () => {
    toastFailures([], "moved", false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names up to three files, counts the rest and says they stay selected", () => {
    toastFailures(fail(5), "moved", false);
    expect(toast.error).toHaveBeenCalledWith("5 files could not be moved", {
      description:
        "f0.txt: exists\nf1.txt: exists\nf2.txt: exists\nand 2 more\nThey are still selected.",
    });
  });

  it("uses the singular for one file and omits 'and N more'", () => {
    toastFailures(fail(1), "renamed", false);
    expect(toast.error).toHaveBeenCalledWith("1 file could not be renamed", {
      description: "f0.txt: exists\nThey are still selected.",
    });
  });

  it("hides file names when redacting", () => {
    toastFailures(fail(1), "moved", true);
    const [, opts] = vi.mocked(toast.error).mock.calls[0]!;
    expect((opts as { description: string }).description).toContain(REDACTED_FILE);
    expect((opts as { description: string }).description).not.toContain("f0.txt");
  });
});

describe("toastStageResult", () => {
  it("says nothing when every file took the edit", () => {
    toastStageResult({ skipped: [], error: null });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("shows a bad regular expression as an error", () => {
    toastStageResult({ skipped: [], error: "Unterminated group" });
    expect(toast.error).toHaveBeenCalledWith("Unterminated group");
  });

  it("counts the files that were left out and says why they can be", () => {
    toastStageResult({ skipped: ["/r/a", "/r/b"], error: null });
    expect(toast.message).toHaveBeenCalledWith(
      "2 files were left out",
      expect.objectContaining({ description: expect.stringContaining("too long") }),
    );
    toastStageResult({ skipped: ["/r/a"], error: null });
    expect(toast.message).toHaveBeenLastCalledWith("1 file was left out", expect.anything());
  });
});
