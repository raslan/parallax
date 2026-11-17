// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunOptions } from "@/lib/subtitleRunDock";
import type { TitleChoice } from "@/types/subtitle";
import { TitlesStep } from "./TitlesStep";

afterEach(cleanup);

const choice: TitleChoice = {
  key: "tv:a",
  group: {
    key: "tv:a",
    title: "Alpha",
    year: 2016,
    type: "tv",
    files: ["/tv/a.mkv"],
    layout_clean: true,
    needs_choice: false,
  },
  files: 1,
  identity: { title: "Alpha", year: 2016, type: "tv" },
  skipped: false,
};

const noOptions: RunOptions = { keepExisting: false, syncAfter: false, engine: "alass" };

function renderStep(extra: Partial<Parameters<typeof TitlesStep>[0]> = {}) {
  const props = {
    titles: [choice],
    scope: "missing" as const,
    onScopeChange: vi.fn(),
    hasTmdbKey: false,
    onIdentity: vi.fn(),
    onToggleSkip: vi.fn(),
    onSearch: vi.fn(),
    checkLengths: true,
    onCheckLengthsChange: vi.fn(),
    autoSave: false,
    onAutoSaveChange: vi.fn(),
    saveOptions: noOptions,
    onSaveOptionsChange: vi.fn(),
    ...extra,
  };
  render(<TitlesStep {...props} />);
  return props;
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLButtonElement;

describe("TitlesStep", () => {
  it("starts the search from the button", () => {
    const p = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Search subtitles for 1 title" }));
    expect(p.onSearch).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the search is being started, so it cannot start twice", () => {
    renderStep({ busy: true });
    const button = screen.getByRole("button", { name: /Search subtitles for 1 title/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Check lengths, on by default, and reports a change", () => {
    const p = renderStep();
    expect(box("Check lengths").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box("Check lengths"));
    expect(p.onCheckLengthsChange).toHaveBeenCalledWith(false);
  });

  it("offers two ways to use the search: review each match (the default) or save the sure ones", () => {
    const p = renderStep();
    expect(
      screen.getByRole("button", { name: "Review each match" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Save the sure matches automatically" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save the sure matches automatically" }));
    expect(p.onAutoSaveChange).toHaveBeenCalledWith(true);
  });

  it("shows no run options and the plain button label while reviewing", () => {
    renderStep();
    expect(screen.queryByRole("checkbox", { name: "Keep existing subtitles" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Sync after download" })).toBeNull();
    expect(screen.getByRole("button", { name: "Search subtitles for 1 title" })).toBeTruthy();
  });

  it("with automatic save: says what is saved, shows the run options, changes the button, forces the check", () => {
    const p = renderStep({ autoSave: true });
    expect(
      screen
        .getByRole("button", { name: "Save the sure matches automatically" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText(/only when the title is confirmed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search and save for 1 title" })).toBeTruthy();
    // Check lengths stays on and cannot be switched off: saving needs it.
    expect(box("Check lengths").getAttribute("aria-checked")).toBe("true");
    expect(box("Check lengths").disabled).toBe(true);
    expect(screen.getByTitle("Needed to save automatically")).toBeTruthy();
    // The run options apply to the automatic save too.
    fireEvent.click(box("Keep existing subtitles"));
    expect(p.onSaveOptionsChange).toHaveBeenCalledWith({ keepExisting: true });
    fireEvent.click(box("Sync after download"));
    expect(p.onSaveOptionsChange).toHaveBeenCalledWith({ syncAfter: true });
    fireEvent.click(screen.getByRole("button", { name: "ffsubsync" }));
    expect(p.onSaveOptionsChange).toHaveBeenCalledWith({ engine: "ffsubsync" });
  });

  it("shows the run options as they stand", () => {
    renderStep({
      autoSave: true,
      saveOptions: { keepExisting: true, syncAfter: true, engine: "ffsubsync" },
    });
    expect(box("Keep existing subtitles").getAttribute("aria-checked")).toBe("true");
    expect(box("Sync after download").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "ffsubsync" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
