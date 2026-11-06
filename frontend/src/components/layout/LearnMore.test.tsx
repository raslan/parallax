// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LearnMore } from "./LearnMore";
import { DOCS_HOST } from "@/lib/docsLink";

afterEach(cleanup);

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LearnMore />
    </MemoryRouter>,
  );

describe("LearnMore", () => {
  it("links to the page's docs in a new tab, named after the page", () => {
    at("/compress");
    const link = screen.getByRole("link", { name: /learn more about compress/i });
    expect(link.getAttribute("href")).toBe(`${DOCS_HOST}/docs/features/compress`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows nothing on a route with no docs page", () => {
    at("/nowhere");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
