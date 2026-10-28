import { describe, expect, it, vi } from "vitest";
import { Trash2 } from "lucide-react";
import { buildRowActions } from "./RowMenu";

describe("buildRowActions", () => {
  it("offers Play and Copy path, then page-specific actions in order", () => {
    const actions = buildRowActions({
      onPlay: vi.fn(),
      path: "/media/a.mkv",
      extra: [{ label: "Delete", icon: Trash2, onSelect: vi.fn(), destructive: true }],
    });
    expect(actions.map((a) => a.label)).toEqual(["Play", "Copy path", "Delete"]);
  });

  it("omits Play without a handler and Copy path without a path", () => {
    expect(buildRowActions({ path: "/x" }).map((a) => a.label)).toEqual(["Copy path"]);
    expect(buildRowActions({ onPlay: vi.fn() }).map((a) => a.label)).toEqual(["Play"]);
  });

  it("is empty when there is nothing to offer", () => {
    expect(buildRowActions({})).toEqual([]);
  });
});
