import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Episode } from "@/lib/api";

interface SortableRowProps {
  id: string;
  filename: string;
  episode: Episode | undefined;
  mediaType: "movie" | "tv";
}

function SortableRow({ id, filename, episode, mediaType }: SortableRowProps) {
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
      className={`flex items-center gap-3 py-2.5 px-2 border-b border-border last:border-0 ${
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

      <span
        className="flex-1 text-xs font-mono text-muted-foreground truncate"
        title={filename}
      >
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

interface FileMatcherProps {
  files: string[];
  episodes: Episode[];
  mediaType: "movie" | "tv";
  onChange: (reorderedFiles: string[]) => void;
}

export function FileMatcher({ files, episodes, mediaType, onChange }: FileMatcherProps) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = files.indexOf(String(active.id));
      const newIdx = files.indexOf(String(over.id));
      onChange(arrayMove(files, oldIdx, newIdx));
    }
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={files} strategy={verticalListSortingStrategy}>
        <div className="rounded-md border border-border overflow-hidden">
          <div className="flex gap-3 px-2 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
            <span className="w-4 shrink-0" />
            <span className="flex-1">Current filename</span>
            <span className="w-4 shrink-0" />
            <span className="flex-1">Will be renamed to</span>
          </div>
          {files.map((file, i) => (
            <SortableRow
              key={file}
              id={file}
              filename={file.split("/").pop() ?? file}
              episode={episodes[i]}
              mediaType={mediaType}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
