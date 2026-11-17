// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Candidate, PreviewInfo, SubtitleFileInfo } from "@/types/subtitle";

const { api, apiProxy, touched } = vi.hoisted(() => {
  const api = {
    preview: vi.fn(),
    existingPreview: vi.fn(),
    unmatchedPreview: vi.fn(),
    previewVttUrl: vi.fn((id: string) => `/api/subtitles/preview/${id}.vtt`),
    releaseTokens: vi.fn(),
    tracks: vi.fn(),
    streamUrl: vi.fn((p: string) => `/api/subtitles/stream?path=${p}`),
  };
  // Every member of `subtitlesApi` the sheet reaches for is recorded; any name outside the
  // read-only allowlist (a write, say) fails the "writes nothing" test.
  const touched = new Set<string>();
  const apiProxy = new Proxy(api as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "string") touched.add(key);
      return target[key as string];
    },
  });
  return { api, apiProxy, touched };
});
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: apiProxy,
  streamApi: { prepare: vi.fn(), status: vi.fn() },
}));
vi.mock("@/hooks/useVideoSource", () => ({
  useVideoSource: ({ streamUrl }: { streamUrl: string }) => ({
    status: "ready",
    src: streamUrl,
    hlsUrl: null,
    progress: 0,
    error: null,
  }),
}));
const player = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/VideoJsPlayer", () => ({
  default: (p: Record<string, unknown>) => {
    player.props = p;
    return <div data-testid="player" />;
  },
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => mobile.value }));

import { CompareSheet } from "./CompareSheet";

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: `Movie.2020.1080p.BluRay-${id}`,
  score: 1,
  hearing_impaired: false,
});
const preview = (id: string, extra: Partial<PreviewInfo> = {}): PreviewInfo => ({
  preview_id: `pv-${id}`,
  cues: 2,
  first: 5,
  last: 3000,
  video_duration: 3070,
  length: "ok",
  lines: [
    { start: 5, text: "Hello there" },
    { start: 90, text: "Goodbye <i>now</i>" },
  ],
  ...extra,
});
const existing: SubtitleFileInfo = {
  path: "/m/Movie.en.srt",
  name: "Movie.en.srt",
  language: "en",
  label: null,
  kind: "real",
  size: 10,
  directory: "",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  touched.clear();
  mobile.value = false;
  player.props = null;
  api.preview.mockImplementation(async (b: { subtitle_id: string }) => preview(b.subtitle_id));
  api.releaseTokens.mockResolvedValue({
    resolution: { value: "1080p", match: true },
    source: { value: "BluRay", match: false },
    group: { value: null, match: null },
  });
  api.tracks.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OK_LENGTH = { length: "ok", last: 3000, videoDuration: 3070 };

const video = { path: "/m/Movie.2020.1080p.WEB.mkv", name: "Movie.2020.1080p.WEB.mkv" };

function renderSheet(props: Partial<Parameters<typeof CompareSheet>[0]> = {}) {
  const onVerdict = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CompareSheet
        video={video}
        mode="candidate"
        candidates={[cand("1"), cand("2")]}
        onVerdict={onVerdict}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onVerdict, onClose };
}

const verdicts = () =>
  within(screen.getByRole("group", { name: "Verdict" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("CompareSheet", () => {
  it("starts afresh when re-opened for another row of the same video", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sheet = (id: string, candidates: Candidate[]) => (
      <QueryClientProvider client={qc}>
        <CompareSheet
          sheetId={id}
          video={video}
          mode="candidate"
          candidates={candidates}
          onVerdict={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(sheet("row:en", [cand("1"), cand("2"), cand("3"), cand("4")]));
    await screen.findByText("Hello there");
    fireEvent.click(screen.getAllByRole("radio")[3]!);
    await screen.findByText("Hello there");
    // the Arabic row of the same video: fewer candidates than the picked index
    rerender(sheet("row:ar", [cand("9")]));
    await screen.findByText("Hello there");
    expect(screen.getByRole("group", { name: "Verdict" })).toBeTruthy();
    expect(screen.getAllByRole("radio")[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("offers exactly Use this, Matches needs sync and Not this one for a candidate", async () => {
    renderSheet();
    await screen.findByText("Hello there");
    expect(verdicts()).toEqual(["Use this", "Matches, needs sync", "Not this one"]);
  });

  it("offers exactly Keep, Sync, Find another and Delete for an existing subtitle", async () => {
    renderSheet({ mode: "existing", candidates: undefined, existing });
    await screen.findByTestId("player");
    expect(verdicts()).toEqual(["Keep", "Sync", "Find another", "Delete"]);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("lists the lines of an existing subtitle and plays that file", async () => {
    api.existingPreview.mockResolvedValue(preview("ex"));
    renderSheet({ mode: "existing", candidates: undefined, existing });
    await screen.findByText("Hello there");
    expect(api.existingPreview).toHaveBeenCalledWith(video.path, existing.path);
    await waitFor(() => expect(player.props?.extraTracks).toBeTruthy());
    expect((player.props?.extraTracks as { url: string }[])[0]?.url).toBe(
      "/api/subtitles/preview/pv-ex.vtt",
    );
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("reads a subtitle found beside no video through the folder-scoped preview", async () => {
    api.unmatchedPreview.mockResolvedValue(preview("st"));
    renderSheet({
      mode: "existing",
      candidates: undefined,
      existing: { ...existing, path: "/m/Subs/2_English.srt" },
      unmatchedRoot: "/m",
    });
    await screen.findByText("Hello there");
    expect(api.unmatchedPreview).toHaveBeenCalledWith("/m", "/m/Subs/2_English.srt", video.path);
    expect(api.existingPreview).not.toHaveBeenCalled();
    // Sync is physically impossible for it (no video owns it) and says why.
    const sync = screen.getByRole("button", { name: "Sync" }) as HTMLButtonElement;
    expect(sync.disabled).toBe(true);
    expect(sync.title).toMatch(/named for the video/);
  });

  it("sends the shown candidate with each candidate verdict", async () => {
    const { onVerdict } = renderSheet();
    await screen.findByText("Hello there");
    fireEvent.click(screen.getByRole("button", { name: "Matches, needs sync" }));
    expect(onVerdict).toHaveBeenLastCalledWith("use_and_sync", cand("1"), OK_LENGTH);
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onVerdict).toHaveBeenLastCalledWith("use", cand("1"), OK_LENGTH);
    fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
    expect(onVerdict).toHaveBeenLastCalledWith("skip", cand("1"), OK_LENGTH);
  });

  it("sends existing verdicts without a candidate", async () => {
    const { onVerdict } = renderSheet({ mode: "existing", candidates: undefined, existing });
    fireEvent.click(screen.getByRole("button", { name: "Find another" }));
    expect(onVerdict).toHaveBeenCalledWith("find_another");
  });

  it("plays the raw candidate through its preview track and writes nothing", async () => {
    renderSheet();
    await screen.findByText("Hello there");
    await waitFor(() => expect(player.props?.extraTracks).toBeTruthy());
    const tracks = player.props?.extraTracks as { url: string }[];
    expect(tracks[0]?.url).toBe("/api/subtitles/preview/pv-1.vtt");
    // Only reads may be reached for: preview, its vtt url, release tokens and the stream.
    const READ_ONLY = [
      "preview",
      "existingPreview",
      "unmatchedPreview",
      "previewVttUrl",
      "releaseTokens",
      "tracks",
      "streamUrl",
    ];
    expect([...touched].filter((k) => !READ_ONLY.includes(k))).toEqual([]);
    expect(touched.has("preview")).toBe(true);
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.preview).toHaveBeenCalledWith({
      video_path: video.path,
      provider: "subf2m",
      subtitle_id: "1",
      language: "en",
    });
  });

  it("sends the video's season and episode with the preview, for a season pack", async () => {
    renderSheet({ video: { ...video, season: 1, episode: 4 } });
    await screen.findByText("Hello there");
    expect(api.preview).toHaveBeenCalledWith({
      video_path: video.path,
      provider: "subf2m",
      subtitle_id: "1",
      language: "en",
      season: 1,
      episode: 4,
    });
  });

  it("tags a season pack in the candidate list", async () => {
    renderSheet({
      candidates: [
        { ...cand("1"), release_kind: "season_pack" },
        { ...cand("2"), release_kind: "episode" },
      ],
    });
    await screen.findByText("Hello there");
    const radios = screen.getAllByRole("radio");
    expect(within(radios[0]!).getByText("season pack")).toBeTruthy();
    expect(within(radios[1]!).queryByText("season pack")).toBeNull();
  });

  it("seeks the player to a clicked line's start, again on a repeat click", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: /Goodbye/ }));
    await waitFor(() => expect((player.props?.seekRequest as { time: number }).time).toBe(90));
    const first = (player.props?.seekRequest as { nonce: number }).nonce;
    fireEvent.click(screen.getByRole("button", { name: /Goodbye/ }));
    await waitFor(() =>
      expect((player.props?.seekRequest as { nonce: number }).nonce).toBeGreaterThan(first),
    );
  });

  it("shows a short length in amber with the real times", async () => {
    api.preview.mockResolvedValue(
      preview("1", { length: "short", last: 2462, video_duration: 3070 }),
    );
    renderSheet();
    const note = await screen.findByText("ends at 41:02, video is 51:10");
    expect(note.className).toContain("text-amber-500");
  });

  it("never blocks a verdict because of the length result", async () => {
    api.preview.mockResolvedValue(preview("1", { length: "short" }));
    const { onVerdict } = renderSheet();
    await screen.findByText(/ends at/);
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onVerdict).toHaveBeenCalledWith(
      "use",
      cand("1"),
      expect.objectContaining({ length: "short" }),
    );
  });

  it("loads another candidate's preview when it is selected", async () => {
    renderSheet();
    await screen.findByText("Hello there");
    api.preview.mockImplementation(async (b: { subtitle_id: string }) =>
      preview(b.subtitle_id, { lines: [{ start: 1, text: "Other candidate line" }] }),
    );
    fireEvent.click(screen.getAllByRole("radio")[1] as HTMLElement);
    await screen.findByText("Other candidate line");
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ subtitle_id: "2" }));
    await waitFor(() =>
      expect((player.props?.extraTracks as { url: string }[])[0]?.url).toBe(
        "/api/subtitles/preview/pv-2.vtt",
      ),
    );
  });

  it("shows release tokens as match, mismatch and neutral chips", async () => {
    renderSheet();
    const ok = await screen.findAllByText("1080p");
    expect(ok[0]?.closest("[data-match]")?.getAttribute("data-match")).toBe("true");
    const bad = screen.getAllByText("BluRay");
    expect(bad[0]?.closest("[data-match]")?.getAttribute("data-match")).toBe("false");
  });

  it("names a failed preview and retries it", async () => {
    api.preview.mockRejectedValueOnce(new Error("Download failed: 404"));
    renderSheet();
    await screen.findByText("Download failed: 404");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Hello there");
  });

  it("keeps the verdict buttons in reach and the line list in its own scroll area", async () => {
    renderSheet();
    await screen.findByText("Hello there");
    const group = screen.getByRole("group", { name: "Verdict" });
    expect(group.className).toContain("sticky");
    expect(group.className).toContain("bottom-0");
    expect(screen.getByRole("list").className).toMatch(/max-h-/);
    expect(screen.getByRole("list").className).toContain("overflow-y-auto");
  });

  it("never lets a long candidate list squeeze the line list to nothing", async () => {
    // Class-level check: the sheet is a flex column that scrolls, so the list must not shrink.
    renderSheet();
    await screen.findByText("Hello there");
    expect(screen.getByRole("list").className).toContain("shrink-0");
    const candidates = screen.getByRole("radiogroup", { name: "Candidates" });
    expect(candidates.className).toContain("shrink-0");
    expect(candidates.className).toContain("max-h-48");
    expect(candidates.className).toContain("overflow-y-auto");
  });

  it("clamps a long release name to one line and keeps the full text in a tooltip", async () => {
    const long = "Movie.2020.BluRay-AAA Movie.2020.WEB-BBB some spam text that goes on and on";
    renderSheet({ candidates: [{ ...cand("1"), release: long }] });
    await screen.findByText("Hello there");
    const name = screen.getByText(long);
    expect(name.className).toContain("truncate");
    expect(name.getAttribute("title")).toBe(long);
  });

  it("says so, with no verdict buttons, when there is nothing to compare", () => {
    renderSheet({ candidates: [] });
    expect(screen.getByText("No other subtitles found")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Verdict" })).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("is a right-hand panel on desktop and a bottom sheet below md", async () => {
    renderSheet();
    await screen.findByText("Hello there");
    expect(screen.getByRole("dialog").className).toContain("right-0");
    cleanup();
    mobile.value = true;
    renderSheet();
    await screen.findByText("Hello there");
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("inset-x-0");
    expect(dialog.className).not.toContain("right-0");
  });
});
