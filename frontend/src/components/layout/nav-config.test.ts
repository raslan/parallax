import { describe, it, expect } from "vitest";
import { routeToTab, SECTIONS } from "./nav-config";

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
