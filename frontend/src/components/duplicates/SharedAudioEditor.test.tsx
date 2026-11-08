// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SharedAudioEditor, type SharedAudioSettings } from "./SharedAudioEditor";

// Radix's slider measures itself with ResizeObserver, which jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const START: SharedAudioSettings = {
  audio_threshold: 0.9,
  audio_similarity: 0.75,
  audio_min_stretch: 10,
};

/** The editor with real state behind it, the way a page holds the criteria. */
function Harness({ onChange }: { onChange: (patch: Partial<SharedAudioSettings>) => void }) {
  const [settings, setSettings] = useState(START);
  return (
    <SharedAudioEditor
      settings={settings}
      runLabel="Find duplicates"
      onChange={(patch) => {
        onChange(patch);
        setSettings((s) => ({ ...s, ...patch }));
      }}
    />
  );
}

const seconds = () => screen.getByLabelText(/Shared for at least/) as HTMLInputElement;

describe("SharedAudioEditor", () => {
  it("names the page's run button in the note about the two server-side settings", () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByText(/takes effect the next time you press/).textContent).toContain(
      "Find duplicates",
    );
  });

  it("limits Sounds alike to the 65-95% the server accepts, and leaves Min shared at 0-100", () => {
    render(<Harness onChange={vi.fn()} />);
    const [soundsAlike, minShared] = screen.getAllByRole("slider");
    expect(soundsAlike!.getAttribute("aria-valuemin")).toBe("65");
    expect(soundsAlike!.getAttribute("aria-valuemax")).toBe("95");
    expect(soundsAlike!.getAttribute("aria-valuenow")).toBe("75");
    expect(minShared!.getAttribute("aria-valuemin")).toBe("0");
    expect(minShared!.getAttribute("aria-valuemax")).toBe("100");
    expect(minShared!.getAttribute("aria-valuenow")).toBe("90");
  });

  it("sends a typed number of seconds, and clamps one the server would refuse", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(seconds(), { target: { value: "25" } });
    expect(onChange).toHaveBeenLastCalledWith({ audio_min_stretch: 25 });

    fireEvent.change(seconds(), { target: { value: "4000" } });
    expect(onChange).toHaveBeenLastCalledWith({ audio_min_stretch: 3600 });
    expect(seconds().value).toBe("4000"); // shown as typed until the field loses focus
    fireEvent.blur(seconds());
    expect(seconds().value).toBe("3600");
  });

  it("does not turn an emptied field into 0 while a new number is being typed", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(seconds(), { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(seconds().value).toBe("");
    fireEvent.change(seconds(), { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({ audio_min_stretch: 5 });
  });

  it("puts the last good number back if the field is left empty", () => {
    render(<Harness onChange={vi.fn()} />);

    fireEvent.change(seconds(), { target: { value: "" } });
    fireEvent.blur(seconds());

    expect(seconds().value).toBe("10");
  });
});
