// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );

describe("Sidebar", () => {
  it("shows only the videos section items on a video route", () => {
    at("/files");
    expect(screen.getByRole("link", { name: /Compress/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Content Review/ })).toBeNull();
  });

  it("shows only the images section items on an image route", () => {
    at("/content-review");
    expect(screen.getByRole("link", { name: /Quarantined/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Originals/ })).toBeNull();
  });

  it("has no Jobs or Settings link", () => {
    at("/files");
    expect(screen.queryByRole("link", { name: /^Jobs$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Settings$/ })).toBeNull();
  });
});
