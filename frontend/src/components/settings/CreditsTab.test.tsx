// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, creditsApi: { get: vi.fn() } };
});

import { creditsApi } from "@/lib/api";
import type { CreditsResponse } from "@/types/credits";
import { CreditsTab } from "./CreditsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreditsTab />
    </QueryClientProvider>,
  );
}

const RESPONSE: CreditsResponse = {
  groups: [
    { id: "upscaling", title: "Image upscaling" },
    { id: "identify", title: "Metadata and naming" },
  ],
  entries: [
    {
      id: "model-a",
      group: "upscaling",
      name: "4xLSDIRCompactC3",
      description: "The Fast upscaling model.",
      author: "Philip Hofmann (Phhofm)",
      licence: "CC BY 4.0",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      url: "https://huggingface.co/Phips/4xLSDIRCompactC3",
      how: "shipped",
    },
    {
      id: "ncnn",
      group: "upscaling",
      name: "ncnn",
      description: "Runs the models.",
      author: "Tencent",
      licence: "BSD 3-Clause",
      licence_url: "https://github.com/Tencent/ncnn/blob/master/LICENSE.txt",
      url: "https://github.com/Tencent/ncnn",
      how: "installed",
      text: "Redistribution and use in source and binary forms",
    },
    {
      id: "tmdb",
      group: "identify",
      name: "TMDB",
      description: "Show details.",
      author: "TMDB",
      licence: "TMDB API terms of use",
      licence_url: "https://www.themoviedb.org/api-terms-of-use",
      url: "https://www.themoviedb.org",
      how: "service",
      notice:
        "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
      logo: "https://www.themoviedb.org/assets/v4/logos/v2/blue_short.svg",
    },
  ],
};

describe("CreditsTab", () => {
  it("lists entries under their group headings with author, licence link and how they are used", async () => {
    vi.mocked(creditsApi.get).mockResolvedValue(RESPONSE);
    renderTab();
    expect(await screen.findByText("Image upscaling")).toBeDefined();
    expect(screen.getByText("Metadata and naming")).toBeDefined();
    expect(screen.getByText("4xLSDIRCompactC3")).toBeDefined();
    expect(screen.getByText("by Philip Hofmann (Phhofm)")).toBeDefined();
    expect(screen.getByText("Included with Parallax")).toBeDefined();
    const licence = screen.getAllByText("CC BY 4.0")[0]!.closest("a");
    expect(licence?.getAttribute("href")).toBe("https://creativecommons.org/licenses/by/4.0/");
  });

  it("keeps licence text behind a disclosure", async () => {
    vi.mocked(creditsApi.get).mockResolvedValue(RESPONSE);
    renderTab();
    expect(await screen.findByText("Licence text")).toBeDefined();
    expect(screen.getByText(/Redistribution and use/)).toBeDefined();
  });

  it("shows the TMDB notice, and hides the logo if it fails to load", async () => {
    vi.mocked(creditsApi.get).mockResolvedValue(RESPONSE);
    const { container } = renderTab();
    expect(await screen.findByText(/not endorsed, certified, or otherwise approved/)).toBeDefined();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("themoviedb.org");
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/not endorsed, certified/)).toBeDefined();
  });
});
