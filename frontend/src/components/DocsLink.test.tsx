// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DocsLink } from "./DocsLink";
import { PageTitle } from "./PageTitle";
import { DOCS_HOST } from "@/lib/docsLink";

afterEach(cleanup);

const at = (path: string, ui = <DocsLink />) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("DocsLink", () => {
  it("links to the page's docs in a new tab, named after the page", () => {
    at("/compress");
    const link = screen.getByRole("link", { name: /documentation for compress/i });
    expect(link.textContent).toBe("Documentation");
    expect(link.getAttribute("href")).toBe(`${DOCS_HOST}/docs/features/compress`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows nothing on a route with no docs page", () => {
    at("/nowhere");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("PageTitle", () => {
  it("puts the link right beside the page's heading", () => {
    at("/cleanup", <PageTitle>Cleanup</PageTitle>);
    const heading = screen.getByRole("heading", { level: 1, name: "Cleanup" });
    expect(heading.nextElementSibling?.textContent).toBe("Documentation");
  });
});
