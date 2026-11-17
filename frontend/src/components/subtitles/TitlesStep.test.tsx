// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function renderStep(extra: Partial<Parameters<typeof TitlesStep>[0]> = {}) {
  const props = {
    titles: [choice],
    scope: "missing" as const,
    onScopeChange: vi.fn(),
    hasTmdbKey: false,
    onIdentity: vi.fn(),
    onToggleSkip: vi.fn(),
    onSearch: vi.fn(),
    ...extra,
  };
  render(<TitlesStep {...props} />);
  return props;
}

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
});
