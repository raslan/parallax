import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, Film, Plus, X, Clapperboard } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import type { Episode } from "@/types/identify";
import { placeFile, poolFiles, seasonsWithMatches, slotKey } from "@/lib/episodeMatching";

const POOL = "__pool__";

function filename(path: string): string {
  return path.split("/").pop() ?? path;
}

function FileCard({ filePath, onRemove }: { filePath: string; onRemove?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: filePath });
  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-border bg-[var(--px-bg-elevated)] pr-1.5 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className="flex flex-1 min-w-0 items-center gap-2 py-1.5 pl-2 cursor-grab active:cursor-grabbing"
      >
        <img
          src={api.identifyThumbnailUrl(filePath)}
          alt=""
          className="h-9 w-16 shrink-0 rounded bg-muted object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <span
          className="flex-1 truncate font-mono text-xs text-foreground"
          title={filename(filePath)}
        >
          {filename(filePath)}
        </span>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Move back to unassigned"
          className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function AssignMenu({ pool, onPick }: { pool: string[]; onPick: (filePath: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Assign file
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-1">
        {pool.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No unassigned files left.</p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {pool.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  onPick(f);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <img
                  src={api.identifyThumbnailUrl(f)}
                  alt=""
                  className="h-8 w-14 shrink-0 rounded bg-muted object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="flex-1 truncate font-mono text-xs" title={filename(f)}>
                  {filename(f)}
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EpisodeStill({ path, alt }: { path: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative h-14 w-[6.25rem] shrink-0 overflow-hidden rounded bg-muted">
      {path && !broken ? (
        <img
          src={`https://image.tmdb.org/t/p/w300${path}`}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Clapperboard className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function EpisodeRow({
  episode,
  mediaType,
  filePath,
  pool,
  onAssign,
  onRemove,
}: {
  episode: Episode;
  mediaType: "movie" | "tv";
  filePath?: string;
  pool: string[];
  onAssign: (filePath: string) => void;
  onRemove: () => void;
}) {
  const key = slotKey(episode.season_number, episode.episode_number);
  const { setNodeRef, isOver } = useDroppable({ id: key });
  const code =
    mediaType === "movie"
      ? "Movie"
      : `S${String(episode.season_number).padStart(2, "0")}E${String(
          episode.episode_number,
        ).padStart(2, "0")}`;
  return (
    <div
      ref={setNodeRef}
      className={`grid grid-cols-[minmax(0,15rem)_1fr] items-center gap-4 border-b border-border px-3 py-3 last:border-0 ${
        isOver ? "bg-primary/10" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <EpisodeStill path={episode.still_path} alt={episode.name} />
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-muted-foreground">{code}</p>
          <p className="truncate text-sm font-medium text-foreground" title={episode.name}>
            {episode.name}
          </p>
        </div>
      </div>
      <div className="min-w-0">
        {filePath ? (
          <FileCard filePath={filePath} onRemove={onRemove} />
        ) : (
          <AssignMenu pool={pool} onPick={onAssign} />
        )}
      </div>
    </div>
  );
}

function PoolColumn({ files }: { files: string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto ${
        isOver ? "border-primary/50 bg-primary/5" : ""
      }`}
    >
      {files.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          Every file is matched. Drag one here to unassign it.
        </p>
      ) : (
        files.map((f) => <FileCard key={f} filePath={f} />)
      )}
    </div>
  );
}

interface MatchBoardProps {
  files: string[];
  episodes: Episode[];
  mediaType: "movie" | "tv";
  assignments: Record<string, string>;
  onAssignmentsChange: (next: Record<string, string>) => void;
}

export function MatchBoard({
  files,
  episodes,
  mediaType,
  assignments,
  onAssignmentsChange,
}: MatchBoardProps) {
  // Seasons that got no auto-match start collapsed; seeded once per mount
  // (the page remounts this with key={tmdb_id} when the show changes).
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    const withMatches = seasonsWithMatches(assignments);
    const all = new Set(episodes.map((e) => e.season_number));
    return new Set([...all].filter((sn) => !withMatches.has(sn)));
  });
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const pool = useMemo(() => poolFiles(files, assignments), [files, assignments]);

  const seasons = useMemo(() => {
    const order: number[] = [];
    const bySeason: Record<number, Episode[]> = {};
    for (const ep of episodes) {
      if (!bySeason[ep.season_number]) {
        order.push(ep.season_number);
        bySeason[ep.season_number] = [];
      }
      bySeason[ep.season_number]!.push(ep);
    }
    return order.map((sn) => ({ sn, eps: bySeason[sn]! }));
  }, [episodes]);

  function toggleSeason(sn: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sn)) {
        next.delete(sn);
      } else {
        next.add(sn);
      }
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFile(null);
    const { active, over } = event;
    if (!over) return;
    onAssignmentsChange(placeFile(assignments, String(active.id), String(over.id)));
  }

  function assignTo(key: string, filePath: string) {
    onAssignmentsChange(placeFile(assignments, filePath, key));
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setActiveFile(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          {mediaType === "movie" ? (
            <div className="overflow-hidden rounded-md border border-border">
              {episodes.map((ep) => {
                const key = slotKey(ep.season_number, ep.episode_number);
                return (
                  <EpisodeRow
                    key={key}
                    episode={ep}
                    mediaType="movie"
                    filePath={assignments[key]}
                    pool={pool}
                    onAssign={(f) => assignTo(key, f)}
                    onRemove={() =>
                      onAssignmentsChange(placeFile(assignments, assignments[key]!, POOL))
                    }
                  />
                );
              })}
            </div>
          ) : (
            seasons.map(({ sn, eps }) => {
              const open = !collapsed.has(sn);
              const filled = eps.filter(
                (ep) => assignments[slotKey(ep.season_number, ep.episode_number)],
              ).length;
              return (
                <div key={sn} className="overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => toggleSeason(sn)}
                    className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/70"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    Season {String(sn).padStart(2, "0")}
                    <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">
                      {filled}/{eps.length}
                    </span>
                  </button>
                  {open &&
                    eps.map((ep) => {
                      const key = slotKey(ep.season_number, ep.episode_number);
                      return (
                        <EpisodeRow
                          key={key}
                          episode={ep}
                          mediaType="tv"
                          filePath={assignments[key]}
                          pool={pool}
                          onAssign={(f) => assignTo(key, f)}
                          onRemove={() =>
                            onAssignmentsChange(placeFile(assignments, assignments[key]!, POOL))
                          }
                        />
                      );
                    })}
                </div>
              );
            })
          )}
        </div>

        <aside className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Unassigned ({pool.length})
          </p>
          <PoolColumn files={pool} />
        </aside>
      </div>

      <DragOverlay>
        {activeFile && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-[var(--px-bg-elevated)] px-2 py-1.5 shadow-lg">
            <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs">{filename(activeFile)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
