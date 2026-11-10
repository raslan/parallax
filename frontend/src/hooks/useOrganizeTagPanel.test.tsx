// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

const getOrganizeTags = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { getOrganizeTags: (p: string[], full?: boolean) => getOrganizeTags(p, full) },
  };
});

import { useOrganizeTagPanel } from "./useOrganizeTagPanel";

const file = (name: string): OrganizeFile => ({
  name,
  path: `/r/${name}`,
  kind: "audio",
  size: 1,
  mtime: 0,
});
// What a batch read carries: the fields only, no raw tags or streams.
const capped = (title: string): OrganizeTagInfo => ({
  fields: { title },
  raw: {},
  streams: [],
  truncated: false,
});

/** One client per test: a client built inside the wrapper would be new on every render. */
function wrapperFor() {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Braces matter: a returned mock would be run by vitest as a teardown hook.
beforeEach(() => {
  getOrganizeTags.mockReset();
});
afterEach(cleanup);

describe("useOrganizeTagPanel", () => {
  it("one file waits for its full tags instead of showing the batch value with an empty tag list", async () => {
    const only = [file("a.mp3")];
    getOrganizeTags.mockImplementation(async () => ({
      tags: { "/r/a.mp3": { ...capped("T"), raw: { title: "T" }, streams: ["audio mp3"] } },
    }));
    const listTags = { "/r/a.mp3": capped("T") };
    const { result } = renderHook(
      () =>
        useOrganizeTagPanel({
          folderPath: "/r",
          files: only,
          tags: listTags,
          enabled: true,
        }),
      { wrapper: wrapperFor() },
    );
    expect(result.current.infos["/r/a.mp3"]).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.infos["/r/a.mp3"]?.raw).toEqual({ title: "T" }));
    expect(result.current.loading).toBe(false);
  });

  it("several files use the list's tags and read only the rest", async () => {
    const two = [file("a.mp3"), file("b.mp3")];
    // Stable identities, like the page's memoised selection and tags.
    const listTags = { "/r/a.mp3": capped("listed") };
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, capped("read")])),
    }));
    const { result } = renderHook(
      () =>
        useOrganizeTagPanel({
          folderPath: "/r",
          files: two,
          tags: listTags,
          enabled: true,
        }),
      { wrapper: wrapperFor() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.infos["/r/a.mp3"]?.fields.title).toBe("listed");
    expect(result.current.infos["/r/b.mp3"]?.fields.title).toBe("read");
    // The list already had a.mp3, so only b.mp3 was read.
    expect(getOrganizeTags.mock.calls.flatMap(([p]) => p)).toEqual(["/r/b.mp3"]);
  });
});
