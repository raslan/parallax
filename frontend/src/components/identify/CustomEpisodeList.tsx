import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, ArrowUpDown, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";

export interface CustomRow {
  path: string;
  episode: number;
  title: string;
}

export interface CustomSeasonGroup {
  seasonNumber: number;
  folderName: string | null;
  rows: CustomRow[];
}

interface CustomEpisodeListProps {
  groups: CustomSeasonGroup[];
  onTitleEdit: (path: string, value: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
  onSetEpisode: (path: string, episode: number) => void;
  onSort: (by: "name" | "date" | "added") => void;
  onReverse: () => void;
  genericTitles: boolean;
  onGenericTitlesChange: (v: boolean) => void;
  groupFoldersAsSeasons: boolean;
  onGroupFoldersAsSeasonsChange: (v: boolean) => void;
  showFoldersAsSeasonsToggle: boolean;
  activeSort: "name" | "date" | "added" | "manual";
  datesLoading: boolean;
  datesUnavailable: boolean;
}

const SORTS = [
  { key: "name", label: "Name" },
  { key: "added", label: "Added" },
  { key: "date", label: "Upload date" },
] as const;

function filename(path: string): string {
  return path.split("/").pop() ?? path;
}

function EpisodeNumberInput({
  season,
  episode,
  max,
  onCommit,
}: {
  season: number;
  episode: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(episode));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(episode));
  }, [episode]);

  function commit() {
    const n = Math.min(max, Math.max(1, parseInt(draft, 10) || episode));
    if (n !== episode) onCommit(n);
    setDraft(String(n));
  }

  return (
    <label
      className="flex shrink-0 items-center gap-1 font-mono text-xs font-medium text-muted-foreground"
      title="Set this file's episode number (shifts the rest within its season)"
    >
      S{String(season).padStart(2, "0")}E
      <input
        type="number"
        min={1}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-14 rounded-md border border-primary/40 bg-[var(--px-bg-elevated)] px-2 py-1 text-center text-sm font-semibold text-foreground transition-colors hover:border-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </label>
  );
}

function SortableRow({
  row,
  season,
  max,
  genericTitles,
  onTitleEdit,
  onSetEpisode,
}: {
  row: CustomRow;
  season: number;
  max: number;
  genericTitles: boolean;
  onTitleEdit: (path: string, value: string) => void;
  onSetEpisode: (path: string, episode: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.path,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-border bg-[var(--px-bg-base)] px-3 py-2.5 last:border-0 ${
        isDragging ? "relative z-10 shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <img
        src={api.identifyThumbnailUrl(row.path)}
        alt=""
        className="h-12 w-[5.5rem] shrink-0 rounded bg-muted object-cover"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />

      <EpisodeNumberInput
        season={season}
        episode={row.episode}
        max={max}
        onCommit={(n) => onSetEpisode(row.path, n)}
      />

      <div className="min-w-0 flex-1">
        <input
          type="text"
          value={row.title}
          onChange={(e) => onTitleEdit(row.path, e.target.value)}
          disabled={genericTitles}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={row.path}>
          {filename(row.path)}
        </p>
      </div>
    </div>
  );
}

function SeasonBlock({
  group,
  genericTitles,
  onTitleEdit,
  onReorder,
  onSetEpisode,
}: {
  group: CustomSeasonGroup;
  genericTitles: boolean;
  onTitleEdit: (path: string, value: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
  onSetEpisode: (path: string, episode: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={group.rows.map((r) => r.path)}
          strategy={verticalListSortingStrategy}
        >
          {group.rows.map((row) => (
            <SortableRow
              key={row.path}
              row={row}
              season={group.seasonNumber}
              max={group.rows.length}
              genericTitles={genericTitles}
              onTitleEdit={onTitleEdit}
              onSetEpisode={onSetEpisode}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function CustomEpisodeList({
  groups,
  onTitleEdit,
  onReorder,
  onSetEpisode,
  onSort,
  onReverse,
  genericTitles,
  onGenericTitlesChange,
  groupFoldersAsSeasons,
  onGroupFoldersAsSeasonsChange,
  showFoldersAsSeasonsToggle,
  activeSort,
  datesLoading,
  datesUnavailable,
}: CustomEpisodeListProps) {
  const totalCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const grouped = groupFoldersAsSeasons && groups.length > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{totalCount}</span> episode
          {totalCount === 1 ? "" : "s"}
          {grouped && <span className="ml-1.5 font-mono">· {groups.length} seasons</span>}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {showFoldersAsSeasonsToggle && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={groupFoldersAsSeasons}
                onCheckedChange={(c) => onGroupFoldersAsSeasonsChange(c === true)}
              />
              Folders are seasons
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={genericTitles}
              onCheckedChange={(c) => onGenericTitlesChange(c === true)}
            />
            Generic titles
          </label>
          <span className="text-xs text-muted-foreground">Sort</span>
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            {SORTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onSort(key)}
                disabled={key === "date" && datesLoading}
                className={`flex items-center gap-1.5 px-2.5 py-1 transition-colors ${
                  activeSort === key ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {key === "date" && datesLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {label}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onReverse} className="gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Reverse
          </Button>
        </div>
      </div>

      {datesUnavailable && (
        <p className="text-xs text-muted-foreground">
          No upload dates are embedded in these files — sort by name, drag, or set numbers by hand.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.folderName ?? `__loose_${group.seasonNumber}`} className="space-y-1.5">
            {grouped && (
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Season {String(group.seasonNumber).padStart(2, "0")}
                {group.folderName && (
                  <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/70">
                    ({group.folderName})
                  </span>
                )}
              </p>
            )}
            <SeasonBlock
              group={group}
              genericTitles={genericTitles}
              onTitleEdit={onTitleEdit}
              onReorder={onReorder}
              onSetEpisode={onSetEpisode}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
