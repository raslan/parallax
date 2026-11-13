// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SubtitlePack } from "@/types/subtitlePack";
import { LanguagePackCard } from "./LanguagePackCard";

const install = vi.fn();
const remove = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { getJob: vi.fn(async () => ({ id: 9, status: "running", progress: 10 })) },
  qk: { job: (id: number) => ["job", id] },
}));

const pack: SubtitlePack = {
  lang: "ar",
  name: "Arabic",
  source_lang: "en",
  model: "OPUS-MT tc-big en-ar",
  size_bytes: 480_000_000,
  installed: false,
  installed_bytes: 0,
  licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  upstream_url: "https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ar",
  installing_job_id: null,
};

const activate = vi.fn();
const show = (p: SubtitlePack, onChange = vi.fn(), withActivate = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguagePackCard
        pack={p}
        onChange={onChange}
        actions={{
          install: (id) => install(id),
          remove: (id) => remove(id),
          ...(withActivate ? { activate: (id: string) => activate(id) } : {}),
        }}
        blurb="Translates English subtitles."
      />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  install.mockReset();
  remove.mockReset();
  activate.mockReset();
});

describe("LanguagePackCard", () => {
  it("lets the user choose an installed model to use globally, like NudeNet's", async () => {
    activate.mockResolvedValue({});
    const onChange = vi.fn();
    show({ ...pack, installed: true, installed_bytes: 1, active: false }, onChange, true);
    fireEvent.click(screen.getByRole("button", { name: /use the arabic language pack/i }));
    await waitFor(() => expect(activate).toHaveBeenCalledWith("ar"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("marks the model in use instead of offering Use", () => {
    show({ ...pack, installed: true, installed_bytes: 1, active: true }, vi.fn(), true);
    expect(screen.getByText("In use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^use the/i })).toBeNull();
  });

  it("has no Use button for things that are not chosen globally (language packs)", () => {
    show({ ...pack, installed: true, installed_bytes: 1 });
    expect(screen.queryByRole("button", { name: /^use the/i })).toBeNull();
    expect(screen.queryByText("In use")).toBeNull();
  });

  it("offers Install for a pack that is not installed, with its licence credit", async () => {
    install.mockResolvedValue({ job_id: 9 });
    show(pack);
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(install).toHaveBeenCalledWith("ar"));
  });

  it("offers Remove, not Install, once installed", async () => {
    remove.mockResolvedValue(undefined);
    const onChange = vi.fn();
    show({ ...pack, installed: true, installed_bytes: 480_000_000 }, onChange);
    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove the arabic language pack/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("shows the server's reason when the install cannot start", async () => {
    install.mockRejectedValue(new Error('409: {"detail":"already installed"}'));
    show(pack);
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    await waitFor(() => expect(screen.getByText(/already installed|Could not start/)).toBeTruthy());
  });
});
