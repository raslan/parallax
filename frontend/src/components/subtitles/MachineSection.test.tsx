// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { blockedReasons } from "@/lib/subtitleCoverage";
import type { ScanFile } from "@/types/subtitle";
import type { SubtitlePack } from "@/types/subtitlePack";
import { MachineSection } from "./MachineSection";

afterEach(cleanup);

const GENERATE_REASON = "Install or choose a speech model in Settings → Subtitles";

const video = (lang: string | null): ScanFile => ({
  path: "/films/Movie.mkv",
  filename: "Movie.mkv",
  relative_dir: "",
  has_subtitle: lang !== null,
  has_any_subtitle: lang !== null,
  languages: {},
  machine_languages: {},
  title: "Movie",
  season: null,
  episode: null,
  year: 2020,
  media_type: "movie",
  subtitles:
    lang === null
      ? []
      : [
          {
            path: `/films/Movie.${lang}.srt`,
            name: `Movie.${lang}.srt`,
            language: lang,
            label: null,
            kind: "real",
            size: 10,
            directory: "",
          },
        ],
});

const pack = (lang: string, name: string, installed = true): SubtitlePack => ({
  lang,
  name,
  source_lang: "en",
  model: "",
  size_bytes: 0,
  installed,
  installed_bytes: 0,
  licence: "",
  licence_url: "",
  upstream_url: "",
  installing_job_id: null,
});

function renderSection(
  files: ScanFile[],
  blocked: ReturnType<typeof blockedReasons>,
  extra: Partial<Parameters<typeof MachineSection>[0]> = {},
) {
  const props = {
    files,
    packs: [pack("ar", "Arabic"), pack("en", "English"), pack("de", "German", false)],
    models: [{ ...pack("whisper-small", "Whisper small"), active: true }],
    blocked,
    keepExisting: false,
    sources: null,
    translating: false,
    generating: false,
    onTranslate: vi.fn(),
    onGenerate: vi.fn(),
    ...extra,
  };
  render(
    <MemoryRouter>
      <MachineSection {...props} />
    </MemoryRouter>,
  );
  return props;
}

const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("MachineSection", () => {
  it("disables Generate with the Settings reason only when no speech model is ready", () => {
    renderSection([video("en")], blockedReasons({ speechModelReady: false, packsInstalled: 2 }));
    expect(button(/^Generate/).disabled).toBe(true);
    expect(screen.getByRole("link", { name: GENERATE_REASON })).toBeTruthy();
  });

  it("enables Generate for a video that already has a real English subtitle", () => {
    const p = renderSection(
      [video("en")],
      blockedReasons({ speechModelReady: true, packsInstalled: 2 }),
      { keepExisting: true },
    );
    expect(button(/^Generate/).disabled).toBe(false);
    expect(screen.queryByText(GENERATE_REASON)).toBeNull();
    fireEvent.click(button(/^Generate/));
    expect(p.onGenerate).toHaveBeenCalledWith({ files: ["/films/Movie.mkv"], model: undefined });
  });

  it("offers every installed pack as a target, even a language with a real subtitle", () => {
    renderSection([video("en")], blockedReasons({ speechModelReady: true, packsInstalled: 2 }));
    const targets = screen.getByRole("group", { name: "Translate into" });
    expect(targets.textContent).toContain("Arabic");
    // English already has a real subtitle here; its pack is still offered.
    expect(targets.textContent).toContain("English");
    expect(targets.textContent).not.toContain("German");
  });

  it("says why Translate waits when Choose a file has no file picked", () => {
    renderSection([video("en")], blockedReasons({ speechModelReady: true, packsInstalled: 2 }), {
      sources: [
        {
          path: "/films/Movie.en.srt",
          filename: "Movie.en.srt",
          machine_made: false,
          hearing_impaired: false,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Arabic" }));
    fireEvent.click(screen.getByRole("button", { name: /Choose a file/ }));
    // No source is chosen yet, so no video is chosen: the count says 0 and the button waits.
    expect(button(/^Translate 0 videos/).disabled).toBe(true);
    expect(screen.getByText("Choose a source file first")).toBeTruthy();
  });

  it("counts one video once a source file is chosen", () => {
    renderSection([video("en")], blockedReasons({ speechModelReady: true, packsInstalled: 2 }), {
      sources: [
        {
          path: "/films/Movie.en.srt",
          filename: "Movie.en.srt",
          machine_made: false,
          hearing_impaired: false,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Choose a file/ }));
    fireEvent.click(screen.getByRole("button", { name: "Movie.en.srt" }));
    expect(button(/^Translate 1 video$/).disabled).toBe(false);
  });

  it("explains why a source file cannot be chosen for several videos", () => {
    renderSection(
      [video("en"), { ...video("en"), path: "/films/Two.mkv", filename: "Two.mkv" }],
      blockedReasons({ speechModelReady: true, packsInstalled: 2 }),
    );
    expect(screen.getByText("A chosen source file applies to one video")).toBeTruthy();
  });

  it("says to select a video when there is none", () => {
    renderSection([], blockedReasons({ speechModelReady: true, packsInstalled: 2 }));
    expect(button(/^Translate 0 videos/).disabled).toBe(true);
    expect(screen.getByText("Select a video")).toBeTruthy();
  });

  it("translates the main English file into the picked language", () => {
    const p = renderSection(
      [video("en")],
      blockedReasons({ speechModelReady: true, packsInstalled: 2 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Arabic" }));
    fireEvent.click(button(/^Translate 1/));
    expect(p.onTranslate).toHaveBeenCalledWith({
      language: "ar",
      files: ["/films/Movie.mkv"],
      source: undefined,
    });
  });
});
