// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpscalePanel } from "./UpscalePanel";
import type { UpscaleTier } from "@/types/upscale";

afterEach(cleanup);

const tiers: UpscaleTier[] = [
  { id: "simple", label: "Simple", scale: 2, speed: "fast", hint: "Conservative", scales: [1, 2] },
  { id: "sharp", label: "Sharp", scale: 2, speed: "fast", hint: "Crisper", scales: [1, 2] },
  { id: "best", label: "Best", scale: 4, speed: "slow", hint: "Highest", scales: [1, 2, 4] },
];

function setup(over: Partial<React.ComponentProps<typeof UpscalePanel>> = {}) {
  const props = {
    tiers,
    tier: "sharp" as const,
    scale: 2 as const,
    resizeMode: "size" as const,
    shrink: 2 as const,
    forceCpu: false,
    gpuAvailable: true,
    sampleDims: { w: 1920, h: 1080 },
    onTierChange: vi.fn(),
    onScaleChange: vi.fn(),
    onResizeModeChange: vi.fn(),
    onShrinkChange: vi.fn(),
    onForceCpuChange: vi.fn(),
    ...over,
  };
  render(
    <MemoryRouter>
      <UpscalePanel {...props} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Upscale settings/ }));
  return props;
}

describe("UpscalePanel", () => {
  it("shows the current choice on the trigger bar", () => {
    setup();
    expect(screen.getAllByText(/Sharp/).length).toBeGreaterThan(0);
  });

  it("disables 4× for a 2× tier and enables it for Best", () => {
    setup();
    expect((screen.getByRole("button", { name: /^4×/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    setup({ tier: "best", scale: 4 });
    expect((screen.getByRole("button", { name: /^4×/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("picking a tier resets the size to that model's native scale", () => {
    const p = setup({ tier: "best", scale: 4 });
    fireEvent.click(screen.getByRole("button", { name: /^Simple/ }));
    expect(p.onTierChange).toHaveBeenCalledWith("simple");
    expect(p.onScaleChange).toHaveBeenCalledWith(2);
    cleanup();
    const q = setup({ tier: "sharp", scale: 2 });
    fireEvent.click(screen.getByRole("button", { name: /^Best/ }));
    expect(q.onScaleChange).toHaveBeenCalledWith(4);
  });

  it("picking a tier with the same native scale leaves the size alone", () => {
    const p = setup({ tier: "sharp", scale: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Simple/ }));
    expect(p.onScaleChange).not.toHaveBeenCalled();
  });

  it("changes the output size", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^1×/ }));
    expect(p.onScaleChange).toHaveBeenCalledWith(1);
  });

  it("offers Output size and Shrink first as the resize method", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Shrink first/ }));
    expect(p.onResizeModeChange).toHaveBeenCalledWith("shrink");
  });

  it("in shrink mode shows shrink factors instead of output sizes", () => {
    const p = setup({ resizeMode: "shrink", shrink: 2 });
    expect(screen.queryByRole("button", { name: /^1×/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^¼/ }));
    expect(p.onShrinkChange).toHaveBeenCalledWith(4);
  });

  it("shows the final size after shrinking then upscaling", () => {
    setup({ resizeMode: "shrink", shrink: 4 });
    // 1920×1080 → 480×270 → ×2 (Sharp's native scale)
    expect(screen.getByText(/960 × 540/)).toBeDefined();
  });

  it("describes shrink-first on the trigger bar", () => {
    setup({ resizeMode: "shrink", shrink: 3 });
    expect(screen.getAllByText(/⅓ then 2×/).length).toBeGreaterThan(0);
  });

  it("calls back from the CPU-only switch", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: /Use CPU only/ }));
    expect(p.onForceCpuChange).toHaveBeenCalledWith(true);
  });

  it("shows relative speed labels instead of times", () => {
    setup();
    expect(screen.getAllByText("Fast")).toHaveLength(2);
    expect(screen.getAllByText("Slow")).toHaveLength(1);
  });

  it("shows output dimensions and the GPU note", () => {
    setup();
    expect(screen.getByText(/3840 × 2160/)).toBeDefined();
    expect(screen.getByText(/GPU detected/)).toBeDefined();
    cleanup();
    setup({ gpuAvailable: false, sampleDims: null });
    expect(screen.getByText(/CPU only — no compatible GPU/)).toBeDefined();
  });

  it("links to the credits tab", () => {
    setup();
    const link = screen.getByRole("link", { name: /Phhofm/ });
    expect(link.getAttribute("href")).toBe("/settings?tab=credits");
  });
});
