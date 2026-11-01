import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, FolderTree } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { GridSizeControl } from "@/components/GridSizeControl";
import { Tip } from "@/components/Tip";
import { ViewToggle, type ViewMode } from "@/components/DataToolbar";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import {
  FOLDER_CARD_HEIGHT,
  FOLDER_ROW_HEIGHT,
  FolderCard,
  type ShareBy,
} from "@/components/prune/FolderCard";
import { useGridSize } from "@/hooks/useGridSize";
import { sortFolders, type FolderSortKey, type SortDir } from "@/lib/pruneSort";
import { cn } from "@/lib/utils";
import type { FolderNodeInfo, PruneFolder } from "@/types/prune";

const SORTS: { key: FolderSortKey; label: string; hint: string }[] = [
  { key: "files", label: "Files", hint: "Sort by number of files" },
  { key: "size", label: "Size", hint: "Sort by total size" },
  { key: "name", label: "Name", hint: "Sort by name" },
];

const MIN_CARD_WIDTH = 200;
const MAX_CARD_WIDTH = 400;

/**
 * Breadcrumb + sortable folder grid/list for the open Prune folder.
 * `folder` undefined means the listing is loading (skeleton). Props-in/
 * callbacks-out; sort and view mode are local, presentation-only state.
 */
export function FolderBrowser({
  folder,
  onNavigate,
  onDelete,
}: {
  folder: PruneFolder | undefined;
  onNavigate: (path: string) => void;
  onDelete?: (folder: FolderNodeInfo) => void;
}) {
  const [sortKey, setSortKey] = useState<FolderSortKey>("files");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [gridSize, setGridSize] = useGridSize(240);
  const cardWidth = Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, gridSize));

  const sorted = useMemo(
    () => (folder ? sortFolders(folder.subfolders, sortKey, sortDir) : []),
    [folder, sortKey, sortDir],
  );

  const shareBy: ShareBy = sortKey === "size" ? "size" : "files";

  function pickSort(key: FolderSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const crumbs = folder?.breadcrumbs ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Folder path" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-0.5 text-sm">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={c.path} className="flex animate-fade-in items-center gap-0.5">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
                  {last ? (
                    <span
                      aria-current="page"
                      className="rounded-md px-1.5 py-0.5 font-medium"
                      style={{ background: "var(--px-accent-dim)" }}
                    >
                      {c.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate(c.path)}
                      className="rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-hidden"
                    >
                      {c.name}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Sort folders"
            className="flex overflow-hidden rounded-md border"
          >
            {SORTS.map(({ key, label, hint }) => {
              const active = key === sortKey;
              const Arrow = sortDir === "asc" ? ArrowUp : ArrowDown;
              return (
                <Tip
                  key={key}
                  label={
                    active
                      ? `${hint} (${sortDir === "asc" ? "ascending" : "descending"}), click to reverse`
                      : hint
                  }
                >
                  <button
                    type="button"
                    onClick={() => pickSort(key)}
                    aria-pressed={active}
                    className={cn(
                      "flex h-8 items-center gap-1 px-2.5 text-xs transition-colors duration-100",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {label}
                    {active && <Arrow key={sortDir} className="h-3 w-3 animate-pop" />}
                  </button>
                </Tip>
              );
            })}
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {viewMode === "grid" && (
            <GridSizeControl
              value={cardWidth}
              onChange={setGridSize}
              min={MIN_CARD_WIDTH}
              max={MAX_CARD_WIDTH}
            />
          )}
        </div>
      </div>

      {!folder ? (
        viewMode === "grid" ? (
          <GridSkeleton count={8} minColumnWidth={cardWidth} />
        ) : (
          <ListSkeleton rows={6} />
        )
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={folder.direct.files > 0 ? FolderOpen : FolderTree}
          title={folder.direct.files > 0 ? "No subfolders here" : "This folder is empty"}
          description={
            folder.direct.files > 0
              ? `${folder.direct.files.toLocaleString()} ${folder.direct.files === 1 ? "file lives" : "files live"} directly in ${folder.name}. Nothing deeper to browse.`
              : `${folder.name} has no files or subfolders that Prune can see (hidden entries are skipped).`
          }
        />
      ) : viewMode === "grid" ? (
        <VirtualizedGrid
          items={sorted}
          getKey={(f) => f.path}
          mode="grid"
          itemHeight={FOLDER_CARD_HEIGHT}
          minColumnWidth={cardWidth}
          maxHeight="65vh"
          resetKey={`${folder.path}-${cardWidth}`}
          renderItem={(f) => (
            <FolderCard
              folder={f}
              parentTotal={folder.total}
              shareBy={shareBy}
              layout="grid"
              index={sorted.indexOf(f)}
              onOpen={onNavigate}
              onDelete={onDelete}
            />
          )}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-px-elevated">
          <VirtualizedGrid
            items={sorted}
            getKey={(f) => f.path}
            mode="list"
            itemHeight={FOLDER_ROW_HEIGHT}
            maxHeight="65vh"
            resetKey={folder.path}
            renderItem={(f) => (
              <FolderCard
                folder={f}
                parentTotal={folder.total}
                shareBy={shareBy}
                layout="list"
                index={sorted.indexOf(f)}
                onOpen={onNavigate}
                onDelete={onDelete}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}
