// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { SubtitleFileInfo } from "@/types/subtitle";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));

import { ManagePanel } from "./ManagePanel";

afterEach(cleanup);

const video = { path: "/m/Movie.mkv", name: "Movie.mkv" };
const file = (
  name: string,
  kind: SubtitleFileInfo["kind"],
  label: string | null = null,
  language = "en",
): SubtitleFileInfo => ({
  path: `/m/${name}`,
  name,
  language,
  label,
  kind,
  size: 2048,
  directory: "",
});
const GENERATE_REASON = "Install or choose a speech model in Settings → Subtitles";

function renderPanel(
  files: SubtitleFileInfo[],
  over: Partial<Parameters<typeof ManagePanel>[0]> = {},
) {
  const onAct = vi.fn();
  render(
    <MemoryRouter>
      <ManagePanel
        video={video}
        files={files}
        unmatched={[]}
        speechModelReady
        installedPacks={["ar"]}
        defaultEngine="alass"
        onAct={onAct}
        onClose={vi.fn()}
        {...over}
      />
    </MemoryRouter>,
  );
  return onAct;
}
const row = (name: string) => screen.getByRole("listitem", { name });
const btn = (scope: HTMLElement | Document, name: RegExp | string) =>
  within(scope as HTMLElement).queryByRole("button", { name }) as HTMLButtonElement | null;

describe("ManagePanel", () => {
  it("shows only Restore and Delete on a .original row", () => {
    renderPanel([
      file("Movie.en.srt", "real"),
      file("Movie.en.original.srt", "original", "original"),
    ]);
    const r = row("Movie.en.original.srt");
    const names = within(r)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Restore", "Delete"]);
  });

  it("offers Make main only on a labelled real file", () => {
    renderPanel([
      file("Movie.en.srt", "real"),
      file("Movie.en.subf2m.srt", "real", "subf2m"),
      file("Movie.en.generated.srt", "generated", "generated"),
    ]);
    expect(btn(row("Movie.en.srt"), /Make main/)).toBeNull();
    expect(btn(row("Movie.en.subf2m.srt"), /Make main/)).not.toBeNull();
    expect(btn(row("Movie.en.generated.srt"), /Make main/)).toBeNull();
  });

  it("every other file action is there whatever the file's state", () => {
    renderPanel([file("Movie.en.generated.srt", "generated", "generated")]);
    const r = row("Movie.en.generated.srt");
    for (const n of [/Play and check/, /Sync/, /Rename/, /Delete/])
      expect((btn(r, n) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Generate with the reason exactly when no speech model is ready", () => {
    renderPanel([file("Movie.en.srt", "real")], { speechModelReady: false });
    expect((btn(document.body, /Generate/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(GENERATE_REASON)).toBeTruthy();
    cleanup();
    renderPanel([file("Movie.en.srt", "real")], { speechModelReady: true });
    expect((btn(document.body, /Generate/) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(GENERATE_REASON)).toBeNull();
    cleanup();
    // Not known yet (loading or failed) is not "no model".
    renderPanel([file("Movie.en.srt", "real")], { speechModelReady: null });
    expect((btn(document.body, /Generate/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Translate and Find subtitles enabled for a video that already has real subtitles", () => {
    const onAct = renderPanel([
      file("Movie.en.srt", "real"),
      file("Movie.ar.srt", "real", null, "ar"),
    ]);
    expect((btn(document.body, /Translate/) as HTMLButtonElement).disabled).toBe(false);
    expect((btn(document.body, /Find subtitles/) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn(document.body, /Find subtitles/)!);
    fireEvent.click(btn(document.body, /Translate/)!);
    expect(onAct.mock.calls.map((c) => c[0].type)).toEqual(["find", "translate"]);
  });

  it("greys Translate with a reason only when it cannot work", () => {
    renderPanel([file("Movie.en.srt", "real")], { installedPacks: [] });
    expect((btn(document.body, /Translate/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Install a language pack/)).toBeTruthy();
    cleanup();
    renderPanel([file("Movie.ar.srt", "real", null, "ar")]);
    expect((btn(document.body, /Translate/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No English subtitle/)).toBeTruthy();
  });

  it("sends a delete with the file's path, a sync with the chosen engine and a rename", () => {
    const f = file("Movie.en.srt", "real");
    const onAct = renderPanel([f]);
    fireEvent.click(btn(row("Movie.en.srt"), /Delete/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "delete", paths: [f.path] });
    fireEvent.click(btn(row("Movie.en.srt"), /Sync/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "sync", path: f.path, engine: "alass" });
    fireEvent.click(screen.getByRole("radio", { name: "ffsubsync" }));
    fireEvent.click(btn(row("Movie.en.srt"), /Sync/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "sync", path: f.path, engine: "ffsubsync" });
    fireEvent.click(btn(row("Movie.en.srt"), /Rename/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "rename", file: f });
    fireEvent.click(btn(row("Movie.en.srt"), /Play and check/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "compare", file: f });
  });

  it("restores a backup over the subtitle it belongs to", () => {
    const onAct = renderPanel([
      file("Movie.en.srt", "real"),
      file("Movie.en.original.srt", "original", "original"),
    ]);
    fireEvent.click(btn(row("Movie.en.original.srt"), /Restore/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "restore", path: "/m/Movie.en.srt" });
  });

  it("offers the three tidy-ups, each with its count", () => {
    const onAct = renderPanel([
      file("Movie.en.srt", "real"),
      file("Movie.en.generated.srt", "generated", "generated"),
      file("Movie.ar.translated.srt", "translated", "translated", "ar"),
      file("Movie.en.original.srt", "original", "original"),
    ]);
    fireEvent.click(btn(document.body, /generated and translated/i)!);
    expect(onAct).toHaveBeenLastCalledWith({
      type: "tidy",
      what: "generated_translated",
      count: 2,
    });
    fireEvent.click(btn(document.body, /sync backups/i)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "tidy", what: "originals", count: 1 });
    // No extra version here: nothing to delete, and it says so.
    expect((btn(document.body, /extra versions/i) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists subfolder files read-only, with the Identify link and no adopt", () => {
    renderPanel([file("Movie.en.srt", "real")], {
      unmatched: [
        { path: "/m/Subs/2_English.srt", name: "2_English.srt", directory: "Subs", language: "en" },
      ],
    });
    expect(screen.getByText(/Subtitle files not named for any video here/)).toBeTruthy();
    expect(screen.getAllByText(/Subs\/2_English\.srt/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Identify" })).toBeTruthy();
    expect(btn(document.body, /adopt/i)).toBeNull();
  });

  it("gives each subfolder file Play and check, Rename and Delete", () => {
    const u = {
      path: "/m/Subs/2_English.srt",
      name: "2_English.srt",
      directory: "Subs",
      language: "en",
    };
    const onAct = renderPanel([file("Movie.en.srt", "real")], { unmatched: [u] });
    const r = screen.getByRole("listitem", { name: "2_English.srt" });
    fireEvent.click(btn(r, /Play and check/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "stray_compare", file: u });
    fireEvent.click(btn(r, /Rename/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "stray_rename", file: u });
    fireEvent.click(btn(r, /Delete/)!);
    expect(onAct).toHaveBeenLastCalledWith({ type: "stray_delete", paths: [u.path] });
    expect(btn(r, /Sync|Make main|Restore/)).toBeNull();
  });
});
