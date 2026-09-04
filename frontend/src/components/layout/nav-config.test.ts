import { describe, it, expect } from "vitest";
import { routeToTab, filterSectionItems, SECTIONS } from "./nav-config";

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
