import { describe, expect, it } from "vitest";
import { errorDetail } from "@/lib/api/client";
import { subfolderNameSchema } from "./organize";

const ok = (name: string) => subfolderNameSchema.safeParse({ name });

describe("subfolderNameSchema", () => {
  it("accepts a plain name and trims it", () => {
    const r = ok("  Trip 2024 ");
    expect(r.success && r.data.name).toBe("Trip 2024");
  });

  it.each(["", "   ", "a/b", "a\\b", ".", "..", ".hidden", "x".repeat(256)])(
    "rejects %j",
    (name) => {
      expect(ok(name).success).toBe(false);
    },
  );
});

describe("errorDetail", () => {
  it("pulls the server's detail out of a req() error", () => {
    const e = new Error('400: {"detail":"Invalid folder name"}');
    expect(errorDetail(e, "fallback")).toBe("Invalid folder name");
  });

  it("falls back for anything else", () => {
    expect(errorDetail(new Error("Failed to fetch"), "fallback")).toBe("fallback");
    expect(errorDetail(new Error("500: not json"), "fallback")).toBe("fallback");
    expect(errorDetail(new Error('422: {"detail":[{"msg":"x"}]}'), "fallback")).toBe("fallback");
  });
});
