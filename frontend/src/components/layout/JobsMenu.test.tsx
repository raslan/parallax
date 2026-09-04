// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

const getJobs = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, getJobs: () => getJobs(), cancelJob: vi.fn() } };
});

// EventSource + matchMedia are stubbed globally in src/test-setup.ts (Task 1).
beforeEach(() => {
  navigate.mockReset();
  getJobs.mockReset();
});
afterEach(cleanup);

import { JobsMenu } from "./JobsMenu";

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobsMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JobsMenu", () => {
  it("shows active and recent jobs when opened", async () => {
    getJobs.mockResolvedValue([
      {
        id: 1,
        type: "compress",
        status: "running",
        progress: 37,
        total_files: 380,
        processed_files: 142,
        library_id: null,
        current_file: null,
        error: null,
        settings: null,
        created_at: "2026-09-04T10:00:00Z",
        started_at: null,
        finished_at: null,
      },
      {
        id: 2,
        type: "scan",
        status: "completed",
        progress: 100,
        total_files: 10,
        processed_files: 10,
        library_id: null,
        current_file: null,
        error: null,
        settings: null,
        created_at: "2026-09-04T09:00:00Z",
        started_at: null,
        finished_at: null,
      },
    ]);
    renderMenu();
    fireEvent.click(await screen.findByRole("button", { name: /jobs/i }));
    expect(await screen.findByText(/Compress/)).toBeDefined();
    expect(screen.getByText(/Scan/)).toBeDefined();
  });

  it("navigates to the focused job on row click", async () => {
    getJobs.mockResolvedValue([
      {
        id: 7,
        type: "whisper_transcribe",
        status: "failed",
        progress: 0,
        total_files: 1,
        processed_files: 0,
        library_id: null,
        current_file: null,
        error: "boom",
        settings: null,
        created_at: "2026-09-04T09:00:00Z",
        started_at: null,
        finished_at: null,
      },
    ]);
    renderMenu();
    fireEvent.click(await screen.findByRole("button", { name: /jobs/i }));
    fireEvent.click(await screen.findByText(/Whisper/));
    expect(navigate).toHaveBeenCalledWith("/jobs?focus=7");
  });
});
