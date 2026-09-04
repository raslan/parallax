import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodResolver } from "./zodResolver";

const schema = z.object({
  path: z.string().min(1, "required").startsWith("/", "must be absolute"),
  count: z.number().min(1).max(32),
});

const ctx = { fields: {}, shouldUseNativeValidation: false };

describe("zodResolver", () => {
  it("returns parsed values and no errors when valid", async () => {
    const r = await zodResolver(schema)({ path: "/media", count: 4 }, undefined, ctx);
    expect(r).toEqual({ values: { path: "/media", count: 4 }, errors: {} });
  });

  it("maps one zod issue per field to { type, message }", async () => {
    const r = await zodResolver(schema)({ path: "", count: 99 }, undefined, ctx);
    expect(r.values).toEqual({});
    // first issue for `path` wins (min before startsWith)
    expect(r.errors.path).toMatchObject({ message: "required" });
    expect(r.errors.count).toMatchObject({ message: expect.stringContaining("32") });
  });
});
