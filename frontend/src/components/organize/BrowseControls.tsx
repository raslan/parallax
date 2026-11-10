import { GridSizeControl } from "@/components/GridSizeControl";
import { ViewToggle, type ViewMode } from "@/components/DataToolbar";
import type { SortDir } from "@/components/FileSelectGrid";
import { SortSelect } from "@/components/SortSelect";
import { TagColumnsMenu } from "@/components/organize/TagColumnsMenu";
import type { TagColumnId } from "@/lib/organizeTags";

/** One sort (key picker + direction arrow) as the page's `useSort` exposes it. */
export interface SortControl<K extends string> {
  label: string;
  options: readonly { value: K; label: string }[];
  value: K;
  dir: SortDir;
  onSort: (key: K) => void;
}

/**
 * The one control strip for the whole browse area (folders and files): the sorts, the
 * view toggle and the card-size slider, in the same spot and order as Cleanup's grid
 * controls. Sticks to the top of the page scroll so it is always in reach. The slider
 * is the shared global card size, the same setting every other page uses. A sort is
 * omitted while there is nothing to sort (no subfolders / no files).
 */
export function BrowseControls<F extends string, G extends string>({
  viewMode,
  onViewMode,
  size,
  onSize,
  folderSort,
  fileSort,
  tagColumns,
}: {
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  size: number;
  onSize: (v: number) => void;
  folderSort?: SortControl<F>;
  fileSort?: SortControl<G>;
  /** The list view's tag columns; the menu shows in list view only. */
  tagColumns?: { selected: TagColumnId[]; onChange: (cols: TagColumnId[]) => void };
}) {
  return (
    <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-b bg-background/85 px-4 py-2 backdrop-blur-sm md:-mx-8 md:px-8">
      {folderSort && <SortSelect {...folderSort} />}
      {fileSort && <SortSelect {...fileSort} />}
      {viewMode === "list" && tagColumns && <TagColumnsMenu {...tagColumns} />}
      <ViewToggle value={viewMode} onChange={onViewMode} />
      {viewMode === "grid" && <GridSizeControl value={size} onChange={onSize} />}
    </div>
  );
}
