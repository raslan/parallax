// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { blockedReasons } from "@/lib/subtitleCoverage";
import { SubtitleDock } from "./SubtitleDock";

afterEach(cleanup);

const GENERATE_REASON = "Install or choose a speech model in Settings → Subtitles";

function renderDock(blocked: ReturnType<typeof blockedReasons>) {
  const handlers = {
    onFind: vi.fn(),
    onTranslate: vi.fn(),
    onGenerate: vi.fn(),
    onSync: vi.fn(),
    onClear: vi.fn(),
  };
  render(
    <MemoryRouter>
      <SubtitleDock count={1} files={34} blocked={blocked} syncing={false} {...handlers} />
    </MemoryRouter>,
  );
  return handlers;
}

const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("SubtitleDock", () => {
  it("enables every action for a title that already has real subtitles", () => {
    // What a file already has never enters the rules: only what is installed does.
    const h = renderDock(blockedReasons({ speechModelReady: true, packsInstalled: 2 }));
    for (const name of [/Find subtitles/, /Translate/, /Generate/, /Sync/]) {
      expect(button(name).disabled).toBe(false);
    }
    fireEvent.click(button(/Sync/));
    expect(h.onSync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(GENERATE_REASON)).toBeNull();
  });

  it("hides button labels below sm but keeps every action named", () => {
    // Class-level check for the phone layout; not verified in a browser.
    renderDock(blockedReasons({ speechModelReady: true, packsInstalled: 2 }));
    for (const name of [/Find subtitles/, /Translate/, /Generate/, /Sync/]) {
      const label = button(name).querySelector("span");
      expect(label?.className).toContain("hidden");
      expect(label?.className).toContain("sm:inline");
      expect(button(name).getAttribute("aria-label")).toMatch(name);
    }
  });

  it("disables Generate with the reason and a Settings link only without a speech model", () => {
    renderDock(blockedReasons({ speechModelReady: false, packsInstalled: 2 }));
    expect(button(/Generate/).disabled).toBe(true);
    expect(button(/Translate/).disabled).toBe(false);
    const link = screen.getByRole("link", { name: GENERATE_REASON });
    expect(link.getAttribute("href")).toBe("/settings?tab=subtitles");
  });

  it("disables Translate with its reason when no language pack is installed", () => {
    renderDock(blockedReasons({ speechModelReady: true, packsInstalled: 0 }));
    expect(button(/Translate/).disabled).toBe(true);
    expect(button(/Generate/).disabled).toBe(false);
    expect(
      screen.getByRole("link", { name: "Install a language pack in Settings → Subtitles" }),
    ).toBeTruthy();
  });
});
