import { describe, expect, it } from "vitest";
import { galleryOptionsSchema, GALLERY_OPTIONS_DEFAULTS } from "./gallery";

describe("galleryOptionsSchema", () => {
  it("fills defaults for an empty object", () => {
    const parsed = galleryOptionsSchema.parse({});
    expect(parsed).toEqual(GALLERY_OPTIONS_DEFAULTS);
    expect(parsed.maxParallel).toBe(2);
    expect(parsed.typeVideo).toBe(true);
    expect(parsed.useArchive).toBe(true);
    expect(parsed.inputMode).toBe("paste");
  });

  it("keeps provided values and defaults the rest", () => {
    const parsed = galleryOptionsSchema.parse({ baseDir: "/media/g", retries: 6, typeImage: true });
    expect(parsed.baseDir).toBe("/media/g");
    expect(parsed.retries).toBe(6);
    expect(parsed.typeImage).toBe(true);
    expect(parsed.typeVideo).toBe(true);
  });

  it("rejects out-of-range maxParallel", () => {
    expect(() => galleryOptionsSchema.parse({ maxParallel: 99 })).toThrow();
  });
});
