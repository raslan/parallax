import { describe, it, expect } from "vitest";
import { DOCS_HOST, docsUrlFor } from "./docsLink";
import { SECTIONS } from "@/components/layout/nav-config";

describe("docsUrlFor", () => {
  it("maps a page to its hosted docs page on the one docs host", () => {
    expect(docsUrlFor("/compress")).toBe(`${DOCS_HOST}/docs/features/compress`);
    expect(docsUrlFor("/")).toBe(`${DOCS_HOST}/docs/general-concepts/home`);
    expect(docsUrlFor("/settings")).toBe(`${DOCS_HOST}/docs/general-concepts/settings`);
  });

  it("shares a page between twins", () => {
    expect(docsUrlFor("/audio-compress")).toBe(docsUrlFor("/compress"));
  });

  it("ignores a trailing slash", () => {
    expect(docsUrlFor("/organize/")).toBe(`${DOCS_HOST}/docs/tools/organize`);
  });

  it("returns null for a route with no docs page", () => {
    expect(docsUrlFor("/nowhere")).toBeNull();
  });

  it("has a docs page for every page in the nav", () => {
    for (const item of SECTIONS.flatMap((s) => s.items)) {
      expect(docsUrlFor(item.to), item.to).not.toBeNull();
    }
  });
});
