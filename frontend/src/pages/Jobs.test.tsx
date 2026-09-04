// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const getJobs = vi.fn();
const getJobLogs = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, getJobs: () => getJobs(), getJobLogs: () => getJobLogs() },
  };
});

beforeEach(() => {
  getJobs.mockReset();
  getJobLogs.mockReset().mockResolvedValue([]);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

import { Jobs } from "./Jobs";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Jobs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const failedJob = {
  id: 7,
  type: "whisper_transcribe",
  status: "failed",
  progress: 0,
  total_files: 1,
  processed_files: 0,
  library_id: null,
  current_file: null,
  error: "bad audio",
  settings: null,
  created_at: "2026-09-04T09:00:00Z",
  started_at: null,
  finished_at: null,
};

const runningJob = {
  id: 12,
  type: "compress",
  status: "running",
  progress: 40,
  total_files: 5,
  processed_files: 2,
  library_id: null,
  current_file: null,
  error: null,
  settings: null,
  created_at: "2026-09-04T09:00:00Z",
  started_at: null,
  finished_at: null,
};

describe("Jobs page focus param", () => {
  it("opens the focused job's log automatically", async () => {
    getJobs.mockResolvedValue([failedJob]);
    const { container } = renderAt("/jobs?focus=7");
    // JobRow requests logs only when logsOpen — so getJobLogs being called proves the panel opened.
    await screen.findByText(/Whisper transcription/);
    expect(getJobLogs).toHaveBeenCalled();
    // The focused row gets the attention-pulse ring.
    expect(container.querySelector(".animate-pulse-ring")).toBeTruthy();
  });

  it("opens the log for a focused non-failed job", async () => {
    getJobs.mockResolvedValue([runningJob]);
    renderAt("/jobs?focus=12");
    await screen.findByText(/Compress/);
    expect(getJobLogs).toHaveBeenCalled();
  });

  it("does not throw when focus id matches no job", async () => {
    getJobs.mockResolvedValue([failedJob]);
    const { container } = renderAt("/jobs?focus=999");
    expect(await screen.findByText(/Whisper transcription/)).toBeDefined();
    expect(container.querySelector(".animate-pulse-ring")).toBeNull();
  });
});
