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

  it("recovers a cleared numeric field (NaN) to its default instead of poisoning the parse", () => {
    const parsed = galleryOptionsSchema.parse({ retries: NaN });
    expect(parsed.retries).toBe(3);
    expect(parsed.httpTimeout).toBe(30);
  });

  it("defaults the yt-dlp options to Downloads-page parity (best / auto, 4 fragments)", () => {
    const d = galleryOptionsSchema.parse({});
    expect(d.ytAudioOnly).toBe(false);
    expect(d.ytQuality).toBe("best");
    expect(d.ytCodec).toBe("auto");
    expect(d.ytConcurrentFragments).toBe(4);
    expect(d.ytRefererMode).toBe("none");
    expect(() => galleryOptionsSchema.parse({ ytQuality: "999" })).toThrow();
    expect(() => galleryOptionsSchema.parse({ ytThrottledRateValue: "fast" })).toThrow();
    expect(() => galleryOptionsSchema.parse({ ytThrottledRateValue: "." })).toThrow();
    for (const ok of ["", "5", "5.", "0.5", ".5"]) {
      expect(galleryOptionsSchema.parse({ ytThrottledRateValue: ok }).ytThrottledRateValue).toBe(
        ok,
      );
    }
  });
});
