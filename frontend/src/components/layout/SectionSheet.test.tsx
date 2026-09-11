// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { qk } from "@/lib/api";
import { SectionSheet } from "./SectionSheet";

afterEach(cleanup);

const renderSheet = (sectionId: "videos" | "images" | "tools" | null, onOpenChange = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.libraries(), [{ id: 1 }]);
  qc.setQueryData(qk.imageLibraries(), [{ id: 1 }]);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/files"]}>
        <SectionSheet sectionId={sectionId} open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onOpenChange;
};

describe("SectionSheet", () => {
  it("lists the target section's pages plus Jobs and Settings", () => {
    renderSheet("images");
    expect(screen.getByRole("link", { name: /Content Review/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /^Jobs$/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /^Settings$/ })).toBeDefined();
    // not the *other* section's pages
    expect(screen.queryByRole("link", { name: /^Files$/ })).toBeNull();
  });

  it("renders nothing navigable when sectionId is null", () => {
    renderSheet(null);
    expect(screen.queryByRole("link", { name: /Content Review/ })).toBeNull();
  });

  it("closes when a page link is clicked", () => {
    const onOpenChange = renderSheet("images");
    fireEvent.click(screen.getByRole("link", { name: /Content Review/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
