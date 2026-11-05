// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, upscaleApi: { credits: vi.fn(), tiers: vi.fn(), start: vi.fn() } };
});

import { upscaleApi } from "@/lib/api";
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

describe("CreditsTab", () => {
  it("lists each model with author, licence link and the conversion note, plus ncnn", async () => {
    vi.mocked(upscaleApi.credits).mockResolvedValue({
      models: [
        {
          name: "4xLSDIRCompactC3",
          tier: "fast",
          author: "Philip Hofmann (Phhofm)",
          licence: "CC-BY-4.0",
          licence_url: "https://creativecommons.org/licenses/by/4.0/",
          release_url: "https://github.com/Phhofm/models/releases/tag/x",
          note: "converted to ncnn format",
        },
      ],
      ncnn: {
        copyright: "Copyright (C) 2017 Tencent. All rights reserved.",
        licence_name: "BSD 3-Clause License",
        url: "https://github.com/Tencent/ncnn",
        text: "Redistribution and use in source and binary forms",
      },
    });
    renderTab();
    expect(await screen.findByText("4xLSDIRCompactC3")).toBeDefined();
    expect(screen.getByText(/Philip Hofmann \(Phhofm\)/)).toBeDefined();
    expect(screen.getByText(/converted to ncnn format/)).toBeDefined();
    const licence = screen.getByRole("link", { name: /CC-BY-4\.0/ });
    expect(licence.getAttribute("href")).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(licence.getAttribute("rel")).toContain("noreferrer");
    expect(licence.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/Copyright \(C\) 2017 Tencent/)).toBeDefined();
    expect(screen.getByText(/Redistribution and use/)).toBeDefined();
  });

  it("shows an error with retry when the request fails", async () => {
    vi.mocked(upscaleApi.credits).mockRejectedValue(new Error("boom"));
    renderTab();
    expect(await screen.findByText(/boom/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeDefined();
  });
});
