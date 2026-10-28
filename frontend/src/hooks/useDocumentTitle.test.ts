import { describe, expect, it } from "vitest";
import { buildDocumentTitle } from "./useDocumentTitle";

describe("buildDocumentTitle", () => {
  it("joins the page label and app name", () => {
    expect(buildDocumentTitle("Compress · Videos", 0)).toBe("Compress · Videos · Parallax");
  });
  it("falls back to the app name when the route has no label", () => {
    expect(buildDocumentTitle(null, 0)).toBe("Parallax");
  });
  it("prefixes the active job count", () => {
    expect(buildDocumentTitle("Jobs", 3)).toBe("(3) Jobs · Parallax");
  });
});
