import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  useDraggable,
  useDroppable,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, Film } from "lucide-react";
import { api } from "@/lib/api";
import type { Episode } from "@/lib/api";
import { placeFile, poolFiles, slotKey } from "@/lib/episodeMatching";

function episodeLabel(episode: Episode, mediaType: "movie" | "tv"): string {
  if (mediaType === "movie") return episode.name;
  const s = String(episode.season_number).padStart(2, "0");
  const e = String(episode.episode_number).padStart(2, "0");
  return `S${s}E${e} — ${episode.name}`;
}

function FileChip({ filePath }: { filePath: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: filePath });
  const filename = filePath.split("/").pop() ?? filePath;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <img
        src={api.identifyThumbnailUrl(filePath)}
        alt=""
        className="h-8 w-14 object-cover rounded shrink-0 bg-muted"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="flex-1 text-xs font-mono text-muted-foreground truncate" title={filename}>
        {filename}
      </span>
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

function SlotRow({
  episode,
  mediaType,
  filePath,
}: {
  episode: Episode;
  mediaType: "movie" | "tv";
  filePath?: string;
}) {
  const key = slotKey(episode.season_number, episode.episode_number);
  const { setNodeRef, isOver } = useDroppable({ id: key });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-3 px-2 py-2 border-b border-border last:border-0 ${isOver ? "bg-primary/10" : ""}`}
    >
      <span className="flex-1 text-xs truncate text-foreground font-medium">
        {episodeLabel(episode, mediaType)}
      </span>
      <span className="text-muted-foreground text-xs shrink-0">←</span>
      <div className="flex-1 min-w-0">
        {filePath ? (
          <FileChip filePath={filePath} />
        ) : (
          <div className="flex items-center px-2 py-1.5 rounded-md border border-dashed border-border text-xs text-muted-foreground italic">
            drop a file here
          </div>
        )}
      </div>
    </div>
  );
}

function PoolPanel({ files }: { files: string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "__pool__" });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border border-dashed border-border p-2 space-y-1.5 min-h-[4rem] ${isOver ? "bg-primary/10" : ""}`}
    >
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 py-2">
          All files are placed. Drag a file here to unassign it.
        </p>
      ) : (
        files.map((f) => <FileChip key={f} filePath={f} />)
      )}
    </div>
  );
}

interface FileMatcherProps {
  files: string[];
  episodes: Episode[];
  mediaType: "movie" | "tv";
  assignments: Record<string, string>;
  onAssignmentsChange: (next: Record<string, string>) => void;
}

export function FileMatcher({
  files,
  episodes,
  mediaType,
  assignments,
  onAssignmentsChange,
}: FileMatcherProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);

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

  function handleDragStart(event: DragStartEvent) {
    setActiveFile(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFile(null);
    const { active, over } = event;
    if (!over) return;
    onAssignmentsChange(placeFile(assignments, String(active.id), String(over.id)));
  }

  const pool = useMemo(() => poolFiles(files, assignments), [files, assignments]);

  const seasonOrder: number[] = [];
  const seasonEpisodes: Record<number, Episode[]> = {};
  for (const ep of episodes) {
    const sn = ep.season_number;
    if (!seasonEpisodes[sn]) {
      seasonOrder.push(sn);
      seasonEpisodes[sn] = [];
    }
    seasonEpisodes[sn].push(ep);
  }

  const activeFilename = activeFile ? (activeFile.split("/").pop() ?? activeFile) : "";

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          {mediaType === "movie" ? (
            <div className="rounded-md border border-border overflow-hidden">
              {episodes.map((ep) => (
                <SlotRow
                  key={slotKey(ep.season_number, ep.episode_number)}
                  episode={ep}
                  mediaType="movie"
                  filePath={assignments[slotKey(ep.season_number, ep.episode_number)]}
                />
              ))}
            </div>
          ) : (
            seasonOrder.map((sn) => {
              const eps = seasonEpisodes[sn];
              const isOpen = !collapsed.has(sn);
              const filledCount = eps.filter(
                (ep) => assignments[slotKey(ep.season_number, ep.episode_number)],
              ).length;
              return (
                <div key={sn} className="rounded-md border border-border overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/70 text-sm font-medium text-left"
                    onClick={() => toggleSeason(sn)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    {`Season ${String(sn).padStart(2, "0")}`}
                    <span className="ml-auto text-xs text-muted-foreground font-normal">
                      {filledCount}/{eps.length} matched
                    </span>
                  </button>
                  {isOpen &&
                    eps.map((ep) => (
                      <SlotRow
                        key={slotKey(ep.season_number, ep.episode_number)}
                        episode={ep}
                        mediaType="tv"
                        filePath={assignments[slotKey(ep.season_number, ep.episode_number)]}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1.5">
            Unplaced files ({pool.length})
          </p>
          <PoolPanel files={pool} />
        </div>
      </div>

      <DragOverlay>
        {activeFile && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background shadow-lg opacity-95">
            <Film className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono truncate">{activeFilename}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
