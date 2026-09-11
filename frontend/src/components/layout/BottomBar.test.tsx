// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BottomBar } from "./BottomBar";

afterEach(cleanup);

const at = (path: string, onOpenSection = vi.fn()) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomBar onOpenSection={onOpenSection} />
    </MemoryRouter>,
  );
  return onOpenSection;
};

describe("BottomBar", () => {
  it("renders one button per section", () => {
    at("/files");
    for (const label of ["Tools", "Videos", "Images"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("marks the active section from the current route", () => {
    at("/content-review");
    expect(screen.getByRole("button", { name: "Images" }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: "Videos" }).getAttribute("data-active")).toBe(
      "false",
    );
  });

  it("calls onOpenSection with the section id on click (never navigates)", () => {
    const spy = at("/files");
    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    expect(spy).toHaveBeenCalledWith("images");
  });
});
