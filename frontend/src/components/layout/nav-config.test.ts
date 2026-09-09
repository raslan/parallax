import { describe, it, expect } from "vitest";
import { routeToTab, filterSectionItems, SECTIONS, sectionItemsById } from "./nav-config";

const byId = (id: string) => SECTIONS.find((s) => s.id === id)!;

describe("filterSectionItems", () => {
  it("collapses the videos section to just Libraries when there are no video libraries", () => {
    const items = filterSectionItems(byId("videos"), false, true);
    expect(items.map((i) => i.label)).toEqual(["Libraries"]);
  });

  it("collapses the images section to just Libraries when there are no image libraries", () => {
    const items = filterSectionItems(byId("images"), true, false);
    expect(items.map((i) => i.label)).toEqual(["Libraries"]);
  });

  it("returns the full list once a library of that type exists", () => {
    expect(filterSectionItems(byId("videos"), true, false)).toEqual(byId("videos").items);
    expect(filterSectionItems(byId("images"), false, true)).toEqual(byId("images").items);
  });

  it("never touches the tools section", () => {
    expect(filterSectionItems(byId("tools"), false, false)).toEqual(byId("tools").items);
  });
});

describe("routeToTab", () => {
  it("maps every section item route to its section id", () => {
    for (const section of SECTIONS) {
      for (const item of section.items) {
        expect(routeToTab(item.to)).toBe(section.id);
      }
    }
  });

  it("maps a nested path under a section route to that section", () => {
    expect(routeToTab("/files/extra")).toBe("videos");
  });

  it("returns null for routes outside every section", () => {
    expect(routeToTab("/jobs")).toBeNull();
    expect(routeToTab("/settings")).toBeNull();
    expect(routeToTab("/")).toBeNull();
  });

  it("does not confuse /image-libraries with /libraries", () => {
    expect(routeToTab("/image-libraries")).toBe("images");
    expect(routeToTab("/libraries")).toBe("videos");
  });
});

describe("sectionItemsById", () => {
  it("returns the tools items regardless of library flags", () => {
    expect(sectionItemsById("tools", false, false).map((i) => i.label)).toEqual([
      "Identify",
      "Subtitles",
      "Downloads",
    ]);
  });

  it("collapses videos to just Libraries when there are no video libraries", () => {
    expect(sectionItemsById("videos", false, true).map((i) => i.label)).toEqual(["Libraries"]);
  });

  it("returns the full images list once an image library exists", () => {
    const byId = (id: string) => SECTIONS.find((s) => s.id === id)!;
    expect(sectionItemsById("images", false, true)).toEqual(byId("images").items);
  });

  it("returns [] for an unknown section id", () => {
    // @ts-expect-error deliberately passing an invalid id
    expect(sectionItemsById("nope", true, true)).toEqual([]);
  });
});
