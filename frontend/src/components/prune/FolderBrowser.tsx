import { useMemo } from "react";
import { ChevronRight, FolderTree, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import type { ViewMode } from "@/components/DataToolbar";
import { ColHeader, type SortDir } from "@/components/FileSelectGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { SortSelect } from "@/components/SortSelect";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import {
  FOLDER_CARD_HEIGHT,
  FOLDER_ROW_HEIGHT,
  FolderCard,
  type ShareBy,
} from "@/components/prune/FolderCard";
import { folderCardWidth } from "@/lib/pruneGrid";
import { sortFolders, type FolderSortKey } from "@/lib/pruneSort";
import type { FolderNodeInfo, PruneFolder } from "@/types/prune";

const SORT_OPTIONS: { value: FolderSortKey; label: string }[] = [
  { value: "files", label: "Files" },
  { value: "size", label: "Size" },
  { value: "name", label: "Name" },
];

/** List-view column headers, in FolderCard's row order. */
const SORT_HEADERS: { value: FolderSortKey; label: string; className: string }[] = [
  { value: "name", label: "Name", className: "flex-1 min-w-0" },
  { value: "files", label: "Files", className: "w-20 shrink-0 justify-end" },
  { value: "size", label: "Size", className: "w-20 shrink-0 justify-end" },
];

/**
 * Breadcrumb + sortable folder grid/list for the open Prune folder.
 * `folder` undefined means the listing is loading (skeleton). Props-in/
 * callbacks-out: the sort (`useSort` in the page) comes in as `sortKey`/`sortDir`
 * and `onSort` (its `toggleSort`), shown as the shared `SortSelect` and, in list
 * view, a `ColHeader` row. View mode and card size come from the page (one
 * control for folders and files); the folder cards clamp the size locally
 * (`folderCardWidth`) without touching the setting. `scrollElement` is the page
 * scroller the grid virtualises against.
 */
export function FolderBrowser({
  folder,
  viewMode,
  cardSize,
  scrollElement,
  sortKey,
  sortDir,
  onSort,
  onNavigate,
  onDelete,
  onDeleteOpen,
  leaving,
}: {
  folder: PruneFolder | undefined;
  viewMode: ViewMode;
  cardSize: number;
  scrollElement: HTMLElement | null;
  sortKey: FolderSortKey;
  sortDir: SortDir;
  onSort: (key: FolderSortKey) => void;
  onNavigate: (path: string) => void;
  /** Delete one of the listed subfolders. */
  onDelete?: (folder: FolderNodeInfo) => void;
  /** Delete the open folder itself (header action); omit at the root. */
  onDeleteOpen?: () => void;
  /** Subfolder paths playing their delete exit animation. */
  leaving?: ReadonlySet<string>;
}) {
  const cardWidth = folderCardWidth(cardSize);

  const sorted = useMemo(
    () => (folder ? sortFolders(folder.subfolders, sortKey, sortDir) : []),
    [folder, sortKey, sortDir],
  );

  const shareBy: ShareBy = sortKey === "size" ? "size" : "files";

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

        {folder && sorted.length > 0 && (
          <SortSelect
            label="Sort folders"
            options={SORT_OPTIONS}
            value={sortKey}
            dir={sortDir}
            onSort={onSort}
          />
        )}
      </div>

      {folder && sorted.length > 0 && (
        <SectionHeader>Folders · {sorted.length.toLocaleString()}</SectionHeader>
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
          {/* Same widths as FolderCard's list row: icon, name, files, size, trash gutter. */}
          <div className="flex items-center gap-3 border-b border-border/30 bg-muted/20 px-3 py-1.5 pr-14">
            <span className="w-4 shrink-0" />
            {SORT_HEADERS.map((h) => (
              <ColHeader
                key={h.value}
                label={h.label}
                sortKey={h.value}
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
                className={h.className}
              />
            ))}
          </div>
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
