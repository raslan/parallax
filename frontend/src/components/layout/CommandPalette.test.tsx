// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { qk } from "@/lib/api";
import { CommandPalette } from "./CommandPalette";

// cmdk measures and scrolls its list; jsdom implements neither.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const renderPalette = ({ video = 1, image = 1, audio = 1, open = true } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const seed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  qc.setQueryData(qk.libraries(), seed(video));
  qc.setQueryData(qk.imageLibraries(), seed(image));
  qc.setQueryData(qk.audioLibraries(), seed(audio));
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommandPalette open={open} onOpenChange={onOpenChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange };
};

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    renderPalette({ open: false });
    expect(screen.queryByPlaceholderText(/Jump to a page/)).toBeNull();
  });

  it("lists pages from every section plus Jobs, Settings and themes", () => {
    renderPalette();
    // Compress exists in both the Videos and Audio sections.
    expect(screen.getAllByText("Compress")).toHaveLength(2);
    expect(screen.getByText("Content Review")).toBeDefined();
    expect(screen.getByText("Downloads")).toBeDefined();
    expect(screen.getByText("Jobs")).toBeDefined();
    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByText("oled")).toBeDefined();
  });

  it("never offers the hidden Galleries page", () => {
    renderPalette();
    expect(screen.queryByText(/galler/i)).toBeNull();
  });

  it("hides pages of a media type that has no libraries yet", () => {
    renderPalette({ image: 0 });
    expect(screen.queryByText("Content Review")).toBeNull();
    expect(screen.getAllByText("Libraries").length).toBeGreaterThan(0);
  });

  it("toggles on Ctrl+K", () => {
    const { onOpenChange } = renderPalette({ open: false });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
