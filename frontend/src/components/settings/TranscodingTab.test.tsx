// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TranscodingTab } from "./TranscodingTab";

// Radix Slider reads ResizeObserver, absent from jsdom (see pages/Galleries.test.tsx).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(cleanup);

const mockSettings = {
  max_concurrent_transcodes: 3,
  encoder_family: "nvenc",
  detected_gpus: [
    { vendor: "nvidia", label: "RTX 5060 Ti" },
    { vendor: "nvidia", label: "RTX 5060 Ti" },
  ],
};

vi.mock("./useSettingsForm", () => ({
  useSettingsForm: () => ({
    form: {
      control: {},
    },
    settings: mockSettings,
    isLoading: false,
    save: { saving: false, saved: false, dirty: false, onSave: vi.fn() },
  }),
}));

vi.mock("react-hook-form", async () => {
  const actual = await vi.importActual("react-hook-form");
  return {
    ...actual,
    Controller: ({ render: renderProp }: { render: (args: unknown) => unknown }) =>
      renderProp({ field: { value: 3, onChange: vi.fn() } }),
  };
});

describe("TranscodingTab", () => {
  it("shows GPU count and model in the hint for multiple NVIDIA GPUs", () => {
    render(<TranscodingTab />);
    expect(screen.getByText(/2× RTX 5060 Ti detected/)).toBeDefined();
  });
});
