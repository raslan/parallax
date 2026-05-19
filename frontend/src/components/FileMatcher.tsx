import { useState } from "react";
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import type { Episode } from "@/lib/api";

interface SortableRowProps {
  id: string;
  filename: string;
  filePath: string;
  episode: Episode | undefined;
  mediaType: "movie" | "tv";
}

function SortableRow({ id, filename, filePath, episode, mediaType }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  function episodeLabel(): string {
    if (!episode) return "";
    if (mediaType === "movie") return episode.name;
    const s = String(episode.season_number).padStart(2, "0");
    const e = String(episode.episode_number).padStart(2, "0");
    return `S${s}E${e} — ${episode.name}`;
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-2 px-2 border-b border-border last:border-0 ${
        isDragging ? "opacity-50 bg-accent rounded" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <img
        src={api.identifyThumbnailUrl(filePath)}
        alt=""
        className="h-9 w-16 object-cover rounded shrink-0 bg-muted"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      <span className="flex-1 text-xs font-mono text-muted-foreground truncate" title={filename}>
        {filename}
      </span>

      <span className="text-muted-foreground text-xs shrink-0">→</span>

      <span className="flex-1 text-xs truncate">
        {episode ? (
          <span className="text-foreground font-medium">{episodeLabel()}</span>
        ) : (
          <span className="text-muted-foreground italic">unmatched — will not be renamed</span>
        )}
      </span>
    </div>
  );
}

interface SeasonSectionProps {
  seasonNumber: number;
  files: string[];
  episodes: Episode[];
  mediaType: "movie" | "tv";
  onReorder: (reorderedFiles: string[]) => void;
}

function SeasonSection({ seasonNumber, files, episodes, mediaType, onReorder }: SeasonSectionProps) {
  const [open, setOpen] = useState(true);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = files.indexOf(String(active.id));
      const newIdx = files.indexOf(String(over.id));
      onReorder(arrayMove(files, oldIdx, newIdx));
    }
  }

  const label = mediaType === "movie" ? "Files" : `Season ${String(seasonNumber).padStart(2, "0")}`;

  return (
    <div className="border border-border rounded-md overflow-hidden mb-3 last:mb-0">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/70 text-sm font-medium text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        {label}
        <span className="ml-auto text-xs text-muted-foreground font-normal">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={files} strategy={verticalListSortingStrategy}>
            <div>
              {files.map((file, i) => (
                <SortableRow
                  key={file}
                  id={file}
                  filePath={file}
                  filename={file.split("/").pop() ?? file}
                  episode={episodes[i]}
                  mediaType={mediaType}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

interface FileMatcherProps {
  files: string[];
  episodes: Episode[];
  mediaType: "movie" | "tv";
  onChange: (reorderedFiles: string[]) => void;
}

export function FileMatcher({ files, episodes, mediaType, onChange }: FileMatcherProps) {
  if (mediaType === "movie") {
    return (
      <SeasonSection
        seasonNumber={0}
        files={files}
        episodes={episodes}
        mediaType="movie"
        onReorder={onChange}
      />
    );
  }

  // Partition files into per-season buckets based on episode season_number sequence.
  // Episodes are sorted by (season, episode); we assign files[i] → episodes[i].
  // Gather unique season numbers in the order they appear in the episodes list.
  const seasonOrder: number[] = [];
  const seasonEpisodes: Record<number, Episode[]> = {};
  for (const ep of episodes) {
    if (!seasonEpisodes[ep.season_number]) {
      seasonOrder.push(ep.season_number);
      seasonEpisodes[ep.season_number] = [];
    }
    seasonEpisodes[ep.season_number].push(ep);
  }

  // Build per-season file slices, consuming from the front of `files`.
  let cursor = 0;
  const seasonFiles: Record<number, string[]> = {};
  for (const sn of seasonOrder) {
    const count = seasonEpisodes[sn].length;
    seasonFiles[sn] = files.slice(cursor, cursor + count);
    cursor += count;
  }
  // Any remaining files (more files than episodes) go to the last season.
  if (cursor < files.length && seasonOrder.length > 0) {
    const last = seasonOrder[seasonOrder.length - 1];
    seasonFiles[last] = [...seasonFiles[last], ...files.slice(cursor)];
  }

  function handleSeasonReorder(seasonNumber: number, reorderedSlice: string[]) {
    // Rebuild the full flat array with the reordered slice in place.
    const next: string[] = [];
    for (const sn of seasonOrder) {
      next.push(...(sn === seasonNumber ? reorderedSlice : seasonFiles[sn]));
    }
    onChange(next);
  }

  return (
    <div>
      <div className="flex gap-3 px-2 py-2 text-xs text-muted-foreground font-medium border border-border rounded-t-md bg-muted/30 border-b-0">
        <span className="w-4 shrink-0" />
        <span className="w-16 shrink-0" />
        <span className="flex-1">Current filename</span>
        <span className="w-4 shrink-0" />
        <span className="flex-1">Will be renamed to</span>
      </div>
      <div>
        {seasonOrder.map((sn) => (
          <SeasonSection
            key={sn}
            seasonNumber={sn}
            files={seasonFiles[sn]}
            episodes={seasonEpisodes[sn]}
            mediaType="tv"
            onReorder={(reordered) => handleSeasonReorder(sn, reordered)}
          />
        ))}
      </div>
    </div>
  );
}
