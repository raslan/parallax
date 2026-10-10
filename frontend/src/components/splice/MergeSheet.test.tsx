// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MergeSheet } from "./MergeSheet";
import type { VideoFile } from "@/types/file";
import type { SplicePreflight } from "@/types/splice";

vi.mock("@/components/VideoThumbnail", () => ({ VideoThumbnail: () => <div /> }));

// Radix Slider measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const file = (id: number, filename: string) =>
  ({ id, filename, duration: 60, size: 1000, scanned_at: null }) as VideoFile;

const pre = (over: Partial<SplicePreflight>): SplicePreflight => ({
  verdict: "copy",
  reference_file_id: 1,
  output_ext: ".mp4",
  output_dir: "/lib",
  name_conflict: false,
  free_bytes: 10 ** 12,
  total_duration: 120,
  total_size: 2000,
  files: [
    {
      file_id: 1,
      filename: "a.mp4",
      size: 1000,
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 24,
      vcodec: "h264",
      acodec: "aac",
      reasons: [],
    },
    {
      file_id: 2,
      filename: "b.mp4",
      size: 1000,
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 24,
      vcodec: "h264",
      acodec: "aac",
      reasons: [],
    },
  ],
  ...over,
});

const base = {
  open: true,
  onOpenChange: vi.fn(),
  files: [file(1, "a.mp4"), file(2, "b.mp4")],
  preflightLoading: false,
  codecs: [],
  outputName: "joined",
  onOutputNameChange: vi.fn(),
  chapters: true,
  onChaptersChange: vi.fn(),
  codec: "h264",
  onCodecChange: vi.fn(),
  crf: 23,
  onCrfChange: vi.fn(),
  speed: "medium",
  onSpeedChange: vi.fn(),
  referenceId: 1,
  onReferenceChange: vi.fn(),
  sortMode: null,
  reverse: false,
  onSort: vi.fn(),
  onReverse: vi.fn(),
  onReorder: vi.fn(),
  onRemove: vi.fn(),
  starting: false,
  startError: null,
  onMerge: vi.fn(),
  preflightError: null,
  forceCpu: false,
  onForceCpuChange: vi.fn(),
};

describe("MergeSheet", () => {
  it("shows the stream-copy banner and hides re-encode controls when compatible", () => {
    render(<MergeSheet {...base} preflight={pre({})} />);
    expect(screen.getByText(/stream copy/i)).toBeTruthy();
    expect(screen.queryByText(/quality \(crf\)/i)).toBeNull();
  });

  it("shows re-encode banner, reasons and controls when files mismatch", () => {
    const p = pre({ verdict: "reencode" });
    p.files[1]!.reasons = ["resolution 1280×720 ≠ 1920×1080"];
    render(<MergeSheet {...base} preflight={p} />);
    expect(screen.getByText(/re-encode needed/i)).toBeTruthy();
    expect(screen.getByText(/resolution 1280×720/)).toBeTruthy();
    expect(screen.getByText(/quality \(crf\)/i)).toBeTruthy();
  });

  it("disables Merge on a name conflict and warns", () => {
    render(<MergeSheet {...base} preflight={pre({ name_conflict: true })} />);
    expect(screen.getByText(/already exists/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /merge 2 files/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("warns when free disk space is short", () => {
    render(<MergeSheet {...base} preflight={pre({ free_bytes: 10 })} />);
    expect(screen.getByText(/low disk space/i)).toBeTruthy();
  });

  it("calls onMerge when enabled", () => {
    const onMerge = vi.fn();
    render(<MergeSheet {...base} onMerge={onMerge} preflight={pre({})} />);
    fireEvent.click(screen.getByRole("button", { name: /merge 2 files/i }));
    expect(onMerge).toHaveBeenCalled();
  });

  it("shows why the preflight failed and keeps Merge disabled", () => {
    render(<MergeSheet {...base} preflight={undefined} preflightError="Could not read gone.mp4" />);
    expect(screen.getByText(/could not read gone\.mp4/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /merge 2 files/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("offers an Encode on CPU switch only when a re-encode is needed", () => {
    const onForceCpuChange = vi.fn();
    const { rerender } = render(
      <MergeSheet {...base} onForceCpuChange={onForceCpuChange} preflight={pre({})} />,
    );
    expect(screen.queryByLabelText(/encode on cpu/i)).toBeNull();
    rerender(
      <MergeSheet
        {...base}
        onForceCpuChange={onForceCpuChange}
        preflight={pre({ verdict: "reencode" })}
      />,
    );
    fireEvent.click(screen.getByLabelText(/encode on cpu/i));
    expect(onForceCpuChange).toHaveBeenCalledWith(true);
  });
});
