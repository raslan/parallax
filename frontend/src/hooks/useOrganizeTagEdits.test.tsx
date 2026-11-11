// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizeFile, OrganizeTagInfo, TagPlan } from "@/types/organize";

const getOrganizeTags = vi.fn();
const planOrganizeTags = vi.fn();
const applyOrganizeTags = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getOrganizeTags: (p: string[], full?: boolean) => getOrganizeTags(p, full),
      planOrganizeTags: (p: string[]) => planOrganizeTags(p),
      applyOrganizeTags: (items: unknown[]) => applyOrganizeTags(items),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { useOrganizeTagEdits } from "./useOrganizeTagEdits";

const file = (name: string, dir = "/r"): OrganizeFile => ({
  name,
  path: `${dir}/${name}`,
  kind: "audio",
  size: 1,
  mtime: 0,
});
const full = (fields: Record<string, string>, extra: Partial<OrganizeTagInfo> = {}) => ({
  fields,
  raw: { ...fields },
  streams: ["audio mp3"],
  truncated: false,
  ...extra,
});
const plan = (p: Partial<TagPlan> = {}): TagPlan => ({
  writable: true,
  how: "rewrite",
  reason: null,
  fields: ["title", "description", "artist", "comment"],
  bytes_needed: 1000,
  note: null,
  can_add_raw: true,
  ...p,
});

/** What the "disk" holds: full tags per path, edited by the apply mock. */
let disk: Record<string, OrganizeTagInfo | null>;

function wrapperFor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  disk = {};
  getOrganizeTags.mockReset().mockImplementation(async (paths: string[]) => ({
    tags: Object.fromEntries(paths.map((p) => [p, disk[p] ?? null])),
  }));
  planOrganizeTags.mockReset().mockImplementation(async (paths: string[]) => ({
    plans: Object.fromEntries(paths.map((p) => [p, plan()])),
    free_bytes: { "/r": 10_000_000, "/other": 5_000_000 },
  }));
  applyOrganizeTags
    .mockReset()
    .mockImplementation(async (items: { path: string; set: Record<string, string | null> }[]) => ({
      results: Object.fromEntries(
        items.map((i) => {
          const cur = disk[i.path]!;
          const fields = { ...cur.fields };
          for (const [k, v] of Object.entries(i.set)) {
            if (v === null) delete fields[k];
            else fields[k] = v;
          }
          disk[i.path] = { ...cur, fields, raw: { ...fields } };
          return [i.path, { status: "written", message: "" }];
        }),
      ),
    }));
});
afterEach(cleanup);

const setup = (
  files: OrganizeFile[],
  opts: { redact?: boolean; onWritten?: (p: string[]) => void; onGone?: () => void } = {},
) =>
  renderHook(
    ({ f }) =>
      useOrganizeTagEdits({
        files: f,
        redact: opts.redact ?? false,
        onWritten: opts.onWritten ?? (() => {}),
        onGone: opts.onGone ?? (() => {}),
      }),
    { wrapper: wrapperFor(), initialProps: { f: files } },
  );

describe("useOrganizeTagEdits: staging", () => {
  it("stage then unstage leaves nothing staged", async () => {
    const files = [file("a.mp3"), file("b.mp3")];
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/r/b.mp3"] = full({ title: "B" });
    const { result } = setup(files);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    expect(result.current.stagedCount).toBe(2);
    expect(result.current.staged["/r/a.mp3"]).toEqual({ artist: "X" });
    act(() => result.current.unstage("artist"));
    expect(result.current.stagedCount).toBe(0);
    expect(result.current.snapshots).toEqual({});
  });

  it("stores a full-tags snapshot per staged file", async () => {
    const files = [file("a.mp3")];
    disk["/r/a.mp3"] = full({ title: "A" }, { streams: ["audio mp3 2ch"] });
    const { result } = setup(files);
    await act(async () => {
      await result.current.stage("title", { op: "set", value: "New" });
    });
    expect(getOrganizeTags).toHaveBeenCalledWith(["/r/a.mp3"], true);
    expect(result.current.snapshots["/r/a.mp3"]?.fields.title).toBe("A");
  });

  it("reads full values one file per request with at most four in flight, and reports progress", async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`f${i}.mp3`));
    files.forEach((f) => (disk[f.path] = full({ title: f.name })));
    let inFlight = 0;
    let max = 0;
    const gates: (() => void)[] = [];
    getOrganizeTags.mockImplementation(async (paths: string[]) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise<void>((r) => gates.push(r));
      inFlight--;
      return { tags: { [paths[0]!]: disk[paths[0]!] } };
    });
    const { result } = setup(files);
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = result.current.stage("title", { op: "append", text: "!" });
    });
    await waitFor(() => expect(gates.length).toBe(4));
    expect(result.current.reading).toEqual({ done: 0, total: 10 });
    while (gates.length) {
      gates.shift()!();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    await act(async () => {
      await done;
    });
    expect(max).toBeLessThanOrEqual(4);
    expect(getOrganizeTags.mock.calls.every(([p, f]) => p.length === 1 && f === true)).toBe(true);
    expect(result.current.reading).toBeNull();
    expect(result.current.stagedCount).toBe(10);
  });

  it("plans are fetched for the selected files only, once per set", async () => {
    const files = [file("a.mp3"), file("b.mp3")];
    const { result, rerender } = setup(files);
    await waitFor(() => expect(result.current.plans["/r/a.mp3"]).toBeDefined());
    expect(planOrganizeTags).toHaveBeenCalledTimes(1);
    expect(planOrganizeTags).toHaveBeenCalledWith(["/r/a.mp3", "/r/b.mp3"]);
    rerender({ f: files });
    await new Promise((r) => setTimeout(r, 20));
    expect(planOrganizeTags).toHaveBeenCalledTimes(1);
  });

  it("a set larger than 50 files is planned in chunks of 50", async () => {
    const files = Array.from({ length: 120 }, (_, i) => file(`f${i}.mp3`));
    const { result } = setup(files);
    await waitFor(() => expect(Object.keys(result.current.plans)).toHaveLength(120));
    expect(planOrganizeTags.mock.calls.map(([p]) => p.length)).toEqual([50, 50, 20]);
  });

  it("staged edits survive a change of selection", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/other/c.mp3"] = full({ title: "C" });
    const { result, rerender } = setup([file("a.mp3")]);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    rerender({ f: [file("c.mp3", "/other")] });
    expect(result.current.staged["/r/a.mp3"]).toEqual({ artist: "X" });
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "Y" });
    });
    expect(Object.keys(result.current.staged).sort()).toEqual(["/other/c.mp3", "/r/a.mp3"]);
  });

  it("the skipped files and a regex error come back from stage", async () => {
    const cut = full({ description: "x".repeat(500) + "…" }, { truncated: true });
    disk["/r/a.mp3"] = cut;
    const { result } = setup([file("a.mp3")]);
    let out: { skipped: string[]; error: string | null } | undefined;
    await act(async () => {
      out = await result.current.stage("description", { op: "append", text: "!" });
    });
    expect(out?.skipped).toEqual(["/r/a.mp3"]);
    await act(async () => {
      out = await result.current.stage("description", {
        op: "replace",
        rule: { find: "(", replace: "", regex: true },
      });
    });
    expect(out?.error).toBeTruthy();
    expect(result.current.stagedCount).toBe(0);
  });

  it("a raw tag name can be added when the plan allows it", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const { result } = setup([file("a.mp3")]);
    await waitFor(() => expect(result.current.plans["/r/a.mp3"]).toBeDefined());
    await act(async () => {
      await result.current.stage("raw:MOOD", { op: "set", value: "calm" });
    });
    expect(result.current.staged["/r/a.mp3"]).toEqual({ "raw:MOOD": "calm" });
  });

  it("with redact on, staging does nothing and makes no request", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const { result } = setup([file("a.mp3")], { redact: true });
    await act(async () => {
      await result.current.stage("title", { op: "set", value: "X" });
    });
    expect(result.current.stagedCount).toBe(0);
    expect(getOrganizeTags).not.toHaveBeenCalled();
    expect(planOrganizeTags).not.toHaveBeenCalled();
  });

  it("drop removes entries for renamed or deleted files and clearAll empties everything", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/r/b.mp3"] = full({ title: "B" });
    const { result } = setup([file("a.mp3"), file("b.mp3")]);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    act(() => result.current.drop(["/r/a.mp3"]));
    expect(Object.keys(result.current.staged)).toEqual(["/r/b.mp3"]);
    expect(Object.keys(result.current.snapshots)).toEqual(["/r/b.mp3"]);
    act(() => result.current.clearAll());
    expect(result.current.stagedCount).toBe(0);
    expect(result.current.snapshots).toEqual({});
  });
});

describe("useOrganizeTagEdits: review and apply", () => {
  it("opening the review re-reads full tags of every staged file, including other folders", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/other/c.mp3"] = full({ title: "C" });
    const { result, rerender } = setup([file("a.mp3")]);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    rerender({ f: [file("c.mp3", "/other")] });
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "Y" });
    });
    getOrganizeTags.mockClear();
    planOrganizeTags.mockClear();
    await act(async () => {
      await result.current.openReview();
    });
    expect(getOrganizeTags.mock.calls.map(([p]) => p[0]).sort()).toEqual([
      "/other/c.mp3",
      "/r/a.mp3",
    ]);
    expect(planOrganizeTags.mock.calls.flatMap(([p]) => p).sort()).toEqual([
      "/other/c.mp3",
      "/r/a.mp3",
    ]);
    expect(result.current.review.open).toBe(true);
    expect(result.current.review.loading).toBe(false);
    expect(result.current.review.rows.map((r) => r.path)).toEqual(["/other/c.mp3", "/r/a.mp3"]);
  });

  it("a file that changed since it was staged is flagged and left out of apply", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/r/b.mp3"] = full({ title: "B" });
    const { result } = setup([file("a.mp3"), file("b.mp3")]);
    await act(async () => {
      await result.current.stage("title", { op: "set", value: "New" });
    });
    disk["/r/a.mp3"] = full({ title: "Edited elsewhere" }); // changed behind our back
    await act(async () => {
      await result.current.openReview();
    });
    const rows = result.current.review.rows;
    expect(rows.find((r) => r.path === "/r/a.mp3")!.stale).toBe("changed");
    expect(rows.find((r) => r.path === "/r/b.mp3")!.stale).toBeNull();
    await act(async () => {
      await result.current.apply();
    });
    expect(applyOrganizeTags).toHaveBeenCalledTimes(1);
    expect(applyOrganizeTags.mock.calls[0]![0]).toEqual([
      { path: "/r/b.mp3", set: { title: "New" } },
    ]);
    expect(disk["/r/a.mp3"]!.fields.title).toBe("Edited elsewhere");
  });

  it("unchanged files are counted as skipped and need space is summed over rewrites", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/r/b.mp3"] = full({ title: "B" });
    const { result } = setup([file("a.mp3"), file("b.mp3")]);
    await act(async () => {
      await result.current.stage("title", { op: "set", value: "A" }); // a is unchanged, b changes
    });
    await act(async () => {
      await result.current.openReview();
    });
    expect(result.current.review.rows.map((r) => r.path)).toEqual(["/r/b.mp3"]);
    expect(result.current.review.neededBytes).toBe(1000);
    expect(result.current.review.freeBytes).toBe(10_000_000);
  });

  it("apply sends chunks of 10 files and reports progress", async () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`f${i}.mp3`));
    files.forEach((f) => (disk[f.path] = full({ title: f.name })));
    const { result } = setup(files);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    const seen: number[] = [];
    applyOrganizeTags.mockImplementation(async (items: { path: string }[]) => {
      seen.push(items.length);
      return {
        results: Object.fromEntries(items.map((i) => [i.path, { status: "written", message: "" }])),
      };
    });
    await act(async () => {
      await result.current.apply();
    });
    expect(seen).toEqual([10, 10, 5]);
    expect(result.current.stagedCount).toBe(0);
    expect(result.current.applying).toBe(false);
  });

  it("written files leave staged, failed ones stay with their message, and only written paths are refreshed", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    disk["/r/b.mp3"] = full({ title: "B" });
    const onWritten = vi.fn();
    const { result } = setup([file("a.mp3"), file("b.mp3")], { onWritten });
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    applyOrganizeTags.mockImplementation(async () => ({
      results: {
        "/r/a.mp3": { status: "written", message: "" },
        "/r/b.mp3": { status: "failed", message: "Not enough free space" },
      },
    }));
    await act(async () => {
      await result.current.apply();
    });
    expect(Object.keys(result.current.staged)).toEqual(["/r/b.mp3"]);
    expect(result.current.results["/r/b.mp3"]).toEqual({
      status: "failed",
      message: "Not enough free space",
    });
    expect(onWritten).toHaveBeenCalledTimes(1);
    expect(onWritten).toHaveBeenCalledWith(["/r/a.mp3"]);
  });

  it("a request that fails marks that chunk failed and keeps it staged", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const { result } = setup([file("a.mp3")]);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    applyOrganizeTags.mockRejectedValue(new Error("500: boom"));
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.results["/r/a.mp3"]?.status).toBe("failed");
    expect(result.current.stagedCount).toBe(1);
    expect(result.current.applying).toBe(false);
  });

  it("a 409 reports the folder gone and keeps everything staged", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const onGone = vi.fn();
    const { result } = setup([file("a.mp3")], { onGone });
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    applyOrganizeTags.mockRejectedValue(new Error('409: {"detail":"No folder selected"}'));
    await act(async () => {
      await result.current.apply();
    });
    expect(onGone).toHaveBeenCalled();
    expect(result.current.stagedCount).toBe(1);
  });

  it("with redact on, apply sends nothing", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const { result, rerender } = renderHook(
      ({ redact }) =>
        useOrganizeTagEdits({
          files: [file("a.mp3")],
          redact,
          onWritten: () => {},
          onGone: () => {},
        }),
      { wrapper: wrapperFor(), initialProps: { redact: false } },
    );
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    rerender({ redact: true });
    await act(async () => {
      await result.current.apply();
    });
    expect(applyOrganizeTags).not.toHaveBeenCalled();
  });

  it("closing the review and staging again clears the last apply's messages", async () => {
    disk["/r/a.mp3"] = full({ title: "A" });
    const { result } = setup([file("a.mp3")]);
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "X" });
    });
    await act(async () => {
      await result.current.openReview();
    });
    applyOrganizeTags.mockResolvedValue({
      results: { "/r/a.mp3": { status: "failed", message: "nope" } },
    });
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.results["/r/a.mp3"]).toBeDefined();
    act(() => result.current.closeReview());
    await act(async () => {
      await result.current.stage("artist", { op: "set", value: "Y" });
    });
    expect(result.current.results).toEqual({});
    expect(result.current.review.open).toBe(false);
  });
});
