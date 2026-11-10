import { useMemo, useState } from "react";
import { reconcileSelection, sameSet, selectedIn } from "@/lib/organizeSelect";
import type { SmartSelectOption } from "@/components/SmartSelect";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import type { OrganizeFile } from "@/types/organize";

/**
 * Organize's selection: a set of paths that is always a subset of the visible
 * (filtered) results.
 *
 * Invariant: derived at render (`actionFiles`), and the stored set is shrunk to match in
 * the same pass (adjusting state during render, no effect) so un-filtering never
 * resurrects selections that a filter hid. Also covers files that vanished from the
 * list. Strict: a file hidden only because its details haven't loaded is dropped too.
 * A refetch (e.g. after a partly failed delete) doesn't hide anything, because
 * useOrganizeDetails keeps unchanged files' details across list identities.
 *
 * A new folder (link, breadcrumb, Back/Forward, a delete moving up) starts with nothing
 * selected, also adjusted during render.
 */
export function useOrganizeSelection({
  currentPath,
  visibleFiles,
  visiblePaths,
  filtered,
}: {
  currentPath: string | null;
  visibleFiles: OrganizeFile[];
  visiblePaths: string[];
  filtered: boolean;
}) {
  const { selected, setSelected, toggle, selectAll, selectNone, setOrder, marqueeProps } =
    useSelection<string>();
  const [shownPath, setShownPath] = useState(currentPath);
  if (shownPath !== currentPath) {
    setShownPath(currentPath);
    selectNone();
  }
  useSelectionOrder(setOrder, visiblePaths);

  const actionFiles = useMemo(() => selectedIn(visibleFiles, selected), [visibleFiles, selected]);
  const selectedPaths = useMemo(() => new Set(actionFiles.map((f) => f.path)), [actionFiles]);
  const shrunk = reconcileSelection(selected, selectedPaths);
  if (shrunk) setSelected(shrunk);

  const smartOptions = useMemo<SmartSelectOption[]>(() => {
    const make = (
      id: string,
      label: string,
      hint: string,
      list: OrganizeFile[],
    ): SmartSelectOption => {
      const paths = list.map((f) => f.path);
      return {
        id,
        label,
        hint,
        count: list.length,
        bytes: list.reduce((n, f) => n + f.size, 0),
        active: list.length > 0 && sameSet(selectedPaths, new Set(paths)),
        onSelect: () => selectAll(paths),
      };
    };
    const kind = (k: OrganizeFile["kind"]) => visibleFiles.filter((f) => f.kind === k);
    return [
      make(
        "matching",
        filtered ? "matching the filters" : "in this folder",
        "Select every file currently shown",
        visibleFiles,
      ),
      make("video", "videos", "Select the videos currently shown", kind("video")),
      make("image", "images", "Select the images currently shown", kind("image")),
      make("audio", "audio", "Select the audio files currently shown", kind("audio")),
      make("other", "other files", "Select the non-media files currently shown", kind("other")),
    ];
  }, [visibleFiles, filtered, selectedPaths, selectAll]);

  return {
    selected,
    setSelected,
    toggle,
    selectAll,
    selectNone,
    marqueeProps,
    actionFiles,
    selectedPaths,
    smartOptions,
  };
}
