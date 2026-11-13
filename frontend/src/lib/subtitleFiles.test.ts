import { describe, expect, it } from "vitest";
import { hasAnySubtitle } from "./subtitleFiles";

describe("hasAnySubtitle", () => {
  it("is false when nothing exists", () => {
    expect(hasAnySubtitle({ languages: { en: false }, machine_languages: { en: false } })).toBe(
      false,
    );
  });

  it("counts a real subtitle", () => {
    expect(hasAnySubtitle({ languages: { en: true }, machine_languages: {} })).toBe(true);
  });

  it("counts a machine-made subtitle, so the row can still be previewed and synced", () => {
    expect(
      hasAnySubtitle({
        languages: { en: false, ar: false },
        machine_languages: { en: true, ar: true },
      }),
    ).toBe(true);
  });

  it("copes with a missing machine map", () => {
    expect(
      hasAnySubtitle({
        languages: { en: false },
        machine_languages: undefined as unknown as Record<string, boolean>,
      }),
    ).toBe(false);
  });
});
