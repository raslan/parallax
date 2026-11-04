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
  {
    id: "natural",
    label: "Natural",
    scale: 4,
    speed: "slow",
    hint: "Clean and photographic",
    scales: [1, 2, 4],
  },
  {
    id: "detailed",
    label: "Detailed",
    scale: 4,
    speed: "slow",
    hint: "Crispest, can invent detail",
    scales: [1, 2, 4],
  },
];

function setup(over: Partial<React.ComponentProps<typeof UpscalePanel>> = {}) {
  const props = {
    tiers,
    tier: "sharp" as const,
    scale: 2 as const,
    resizeMode: "size" as const,
    prescale: 50,
    forceCpu: false,
    gpuAvailable: true,
    sampleDims: { w: 1920, h: 1080 },
    onTierChange: vi.fn(),
    onScaleChange: vi.fn(),
    onResizeModeChange: vi.fn(),
    onPrescaleChange: vi.fn(),
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

const percentInput = () => screen.getByLabelText(/Pre-scale percentage/) as HTMLInputElement;

describe("UpscalePanel", () => {
  it("shows the current choice on the trigger bar", () => {
    setup();
    expect(screen.getAllByText(/Sharp/).length).toBeGreaterThan(0);
  });

  it("disables 4× for a 2× tier and enables it for a 4× tier", () => {
    setup();
    expect((screen.getByRole("button", { name: /^4×/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    setup({ tier: "natural", scale: 4 });
    expect((screen.getByRole("button", { name: /^4×/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("describes the current tier under Quality", () => {
    setup({ tier: "natural", scale: 4 });
    expect(screen.getByText("Clean and photographic", { selector: "p" })).toBeDefined();
  });

  it("picking a tier resets the size to that model's native scale", () => {
    const p = setup({ tier: "natural", scale: 4 });
    fireEvent.click(screen.getByRole("button", { name: /^Simple/ }));
    expect(p.onTierChange).toHaveBeenCalledWith("simple");
    expect(p.onScaleChange).toHaveBeenCalledWith(2);
    cleanup();
    const q = setup({ tier: "sharp", scale: 2 });
    fireEvent.click(screen.getByRole("button", { name: /^Natural/ }));
    expect(q.onScaleChange).toHaveBeenCalledWith(4);
  });

  it("picking a tier with the same native scale leaves the size alone", () => {
    const p = setup({ tier: "natural", scale: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Detailed/ }));
    expect(p.onTierChange).toHaveBeenCalledWith("detailed");
    expect(p.onScaleChange).not.toHaveBeenCalled();
  });

  it("changes the output size", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^1×/ }));
    expect(p.onScaleChange).toHaveBeenCalledWith(1);
  });

  it("offers Output size and Pre-scale as the resize method", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Pre-scale/ }));
    expect(p.onResizeModeChange).toHaveBeenCalledWith("prescale");
  });

  it("in pre-scale mode shows percentages instead of output sizes", () => {
    setup({ resizeMode: "prescale" });
    expect(screen.queryByRole("button", { name: /^1×/ })).toBeNull();
    expect(percentInput().value).toBe("50");
  });

  it("fills the percentage from the 25 / 50 / 75 chips", () => {
    const p = setup({ resizeMode: "prescale", prescale: 50 });
    fireEvent.click(screen.getByRole("button", { name: /^75%/ }));
    expect(p.onPrescaleChange).toHaveBeenCalledWith(75);
    fireEvent.click(screen.getByRole("button", { name: /^25%/ }));
    expect(p.onPrescaleChange).toHaveBeenCalledWith(25);
  });

  it("marks the chip that matches the current percentage, and none for a custom one", () => {
    setup({ resizeMode: "prescale", prescale: 50 });
    expect(screen.getByRole("button", { name: /^50%/ }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    setup({ resizeMode: "prescale", prescale: 60 });
    expect(screen.getByRole("button", { name: /^50%/ }).getAttribute("aria-pressed")).toBe("false");
    expect(percentInput().value).toBe("60");
  });

  it("takes any whole percentage typed into the input", () => {
    const p = setup({ resizeMode: "prescale" });
    fireEvent.change(percentInput(), { target: { value: "62" } });
    expect(p.onPrescaleChange).toHaveBeenCalledWith(62);
  });

  it("waits for a valid percentage while typing, then clamps on blur", () => {
    const p = setup({ resizeMode: "prescale" });
    fireEvent.change(percentInput(), { target: { value: "5" } }); // on the way to "50"
    expect(p.onPrescaleChange).not.toHaveBeenCalled();
    expect(percentInput().value).toBe("5");
    fireEvent.blur(percentInput());
    expect(p.onPrescaleChange).toHaveBeenCalledWith(10);
  });

  it("shows how much bigger the copy is and its final size", () => {
    setup({ resizeMode: "prescale", prescale: 75, tier: "natural", scale: 4 });
    // 1920×1080 → 1440×810 → ×4 (Natural's native scale)
    expect(screen.getByText(/5760 × 3240/)).toBeDefined();
    expect(screen.getByText(/3× the original/)).toBeDefined();
  });

  it("describes the pre-scale on the trigger bar", () => {
    setup({ resizeMode: "prescale", prescale: 75, tier: "natural", scale: 4 });
    expect(screen.getAllByText(/75% then 4×/).length).toBeGreaterThan(0);
  });

  it("calls back from the CPU-only switch", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: /Use CPU only/ }));
    expect(p.onForceCpuChange).toHaveBeenCalledWith(true);
  });

  it("shows relative speed labels instead of times", () => {
    setup();
    expect(screen.getAllByText("Fast")).toHaveLength(2);
    expect(screen.getAllByText("Slow")).toHaveLength(2);
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
