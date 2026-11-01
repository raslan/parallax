import { GridSizeControl } from "@/components/GridSizeControl";
import { ViewToggle, type ViewMode } from "@/components/DataToolbar";

/**
 * The one view toggle + card-size slider for the whole browse area (folders and
 * files). Sticks to the top of the page scroll so it is always in reach. The
 * slider is the shared global card size, the same setting every other page uses.
 */
export function BrowseControls({
  viewMode,
  onViewMode,
  size,
  onSize,
}: {
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  size: number;
  onSize: (v: number) => void;
}) {
  return (
    <div className="sticky top-0 z-30 -mx-6 flex justify-end gap-3 border-b bg-background/85 px-6 py-2 backdrop-blur-sm">
      <ViewToggle value={viewMode} onChange={onViewMode} />
      {viewMode === "grid" && <GridSizeControl value={size} onChange={onSize} />}
    </div>
  );
}
