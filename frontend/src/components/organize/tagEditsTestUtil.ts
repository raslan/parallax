import { vi } from "vitest";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import type { OrganizeFile, OrganizeTagInfo, TagPlan } from "@/types/organize";

/** An inert stand-in for the staging hook: every action is a spy, the state is what a test sets. */
export function makeEdits(over: Partial<TagEdits> = {}): TagEdits {
  return {
    staged: {},
    snapshots: {},
    stagedCount: 0,
    plans: {},
    planLoading: false,
    stage: vi.fn(async () => ({ skipped: [] as string[], error: null as string | null })),
    unstage: vi.fn(),
    reading: null,
    review: {
      open: false,
      loading: false,
      rows: [],
      skippedCount: 0,
      neededBytes: 0,
      freeBytes: null,
    },
    openReview: vi.fn(async () => {}),
    closeReview: vi.fn(),
    apply: vi.fn(async () => {}),
    applying: false,
    progress: null,
    results: {},
    drop: vi.fn(),
    clearAll: vi.fn(),
    ...over,
  };
}

export const aFile = (name: string, dir = "/r"): OrganizeFile => ({
  name,
  path: `${dir}/${name}`,
  kind: "audio",
  size: 1000,
  mtime: 0,
});

export const aPlan = (over: Partial<TagPlan> = {}): TagPlan => ({
  writable: true,
  how: "rewrite",
  reason: null,
  fields: ["title", "description", "synopsis", "comment", "artist", "album", "genre", "date"],
  bytes_needed: 5_000_000,
  note: null,
  can_add_raw: true,
  ...over,
});

export const someTags = (
  fields: Record<string, string>,
  raw: Record<string, string> = fields,
): OrganizeTagInfo => ({ fields, raw, streams: ["audio mp3 2ch"], truncated: false });
