import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FolderTree, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Tip } from "@/components/Tip";
import type { ViewMode } from "@/components/DataToolbar";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import {
  FOLDER_CARD_HEIGHT,
  FOLDER_ROW_HEIGHT,
  FolderCard,
  type ShareBy,
} from "@/components/prune/FolderCard";
import { folderCardWidth } from "@/lib/pruneGrid";
import { sortFolders, type FolderSortKey, type SortDir } from "@/lib/pruneSort";
import { cn } from "@/lib/utils";
import type { FolderNodeInfo, PruneFolder } from "@/types/prune";

const SORTS: { key: FolderSortKey; label: string; hint: string }[] = [
  { key: "files", label: "Files", hint: "Sort by number of files" },
  { key: "size", label: "Size", hint: "Sort by total size" },
  { key: "name", label: "Name", hint: "Sort by name" },
];

/**
 * Breadcrumb + sortable folder grid/list for the open Prune folder.
 * `folder` undefined means the listing is loading (skeleton). Props-in/
 * callbacks-out; sort is local, presentation-only state. View mode and card
 * size come from the page (one control for folders and files); the folder cards
 * clamp the size locally (`folderCardWidth`) without touching the setting.
 * `scrollElement` is the page scroller the grid virtualises against.
 */
export function FolderBrowser({
  folder,
  viewMode,
  cardSize,
  scrollElement,
  onNavigate,
  onDelete,
  onDeleteOpen,
  leaving,
}: {
  folder: PruneFolder | undefined;
  viewMode: ViewMode;
  cardSize: number;
  scrollElement: HTMLElement | null;
  onNavigate: (path: string) => void;
  /** Delete one of the listed subfolders. */
  onDelete?: (folder: FolderNodeInfo) => void;
  /** Delete the open folder itself (header action); omit at the root. */
  onDeleteOpen?: () => void;
  /** Subfolder paths playing their delete exit animation. */
  leaving?: ReadonlySet<string>;
}) {
  const [sortKey, setSortKey] = useState<FolderSortKey>("files");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const cardWidth = folderCardWidth(cardSize);

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
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center">
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
          {onDeleteOpen && folder && (
            <IconButton
              label={`Delete ${folder.name}`}
              onClick={onDeleteOpen}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors duration-100 hover:border-destructive/50 hover:text-destructive focus-visible:border-destructive/50 focus-visible:outline-hidden"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
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
        </div>
      </div>

      {folder && sorted.length > 0 && (
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Folders · {sorted.length.toLocaleString()}
        </h2>
      )}

      {!folder ? (
        viewMode === "grid" ? (
          <GridSkeleton count={8} minColumnWidth={cardWidth} />
        ) : (
          <ListSkeleton rows={6} />
        )
      ) : sorted.length === 0 ? (
        // A folder with only files is not empty: the file browser below shows them.
        folder.direct.files > 0 ? null : (
          <EmptyState
            icon={FolderTree}
            title="This folder is empty"
            description={`${folder.name} has no files or subfolders that Prune can see (hidden entries are skipped).`}
          />
        )
      ) : viewMode === "grid" ? (
        <VirtualizedGrid
          items={sorted}
          getKey={(f) => f.path}
          mode="grid"
          itemHeight={FOLDER_CARD_HEIGHT}
          minColumnWidth={cardWidth}
          scrollElement={scrollElement}
          renderItem={(f) => (
            <FolderCard
              folder={f}
              parentTotal={folder.total}
              shareBy={shareBy}
              layout="grid"
              index={sorted.indexOf(f)}
              leaving={leaving?.has(f.path)}
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
            scrollElement={scrollElement}
            renderItem={(f) => (
              <FolderCard
                folder={f}
                parentTotal={folder.total}
                shareBy={shareBy}
                layout="list"
                index={sorted.indexOf(f)}
                leaving={leaving?.has(f.path)}
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
