import { useState } from "react";
import { DndContext, closestCenter, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
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

interface RowData {
  filePath: string;
  filename: string;
  episode: Episode | undefined;
  mediaType: "movie" | "tv";
}

function episodeLabel(episode: Episode, mediaType: "movie" | "tv"): string {
  if (mediaType === "movie") return episode.name;
  const s = String(episode.season_number).padStart(2, "0");
  const e = String(episode.episode_number).padStart(2, "0");
  return `S${s}E${e} — ${episode.name}`;
}

function RowContent({ filePath, filename, episode, mediaType }: RowData) {
  return (
    <>
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
          <span className="text-foreground font-medium">{episodeLabel(episode, mediaType)}</span>
        ) : (
          <span className="text-muted-foreground italic">unmatched — will not be renamed</span>
        )}
      </span>
    </>
  );
}

function SortableRow({ filePath, filename, episode, mediaType }: RowData) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: filePath });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-2 px-2 border-b border-border last:border-0 ${
        isDragging ? "opacity-30" : ""
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
      <RowContent filePath={filePath} filename={filename} episode={episode} mediaType={mediaType} />
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
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);

  function toggleSeason(sn: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(sn) ? next.delete(sn) : next.add(sn);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveFile(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFile(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = files.indexOf(String(active.id));
      const newIdx = files.indexOf(String(over.id));
      if (oldIdx !== -1 && newIdx !== -1) {
        onChange(arrayMove(files, oldIdx, newIdx));
      }
    }
  }

  // Build season groups: ordered list of (seasonNumber, indices into files[])
  const seasonOrder: number[] = [];
  const seasonIndices: Record<number, number[]> = {};
  for (let i = 0; i < files.length; i++) {
    const sn = episodes[i]?.season_number ?? 0;
    if (!seasonIndices[sn]) {
      seasonOrder.push(sn);
      seasonIndices[sn] = [];
    }
    seasonIndices[sn].push(i);
  }

  const activeIdx = activeFile ? files.indexOf(activeFile) : -1;
  const activeEpisode = activeIdx !== -1 ? episodes[activeIdx] : undefined;
  const activeFilename = activeFile ? activeFile.split("/").pop() ?? activeFile : "";

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={files} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {mediaType === "movie" ? (
            <div className="rounded-md border border-border overflow-hidden">
              <div className="flex gap-3 px-2 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
                <span className="w-4 shrink-0" />
                <span className="w-16 shrink-0" />
                <span className="flex-1">Current filename</span>
                <span className="w-4 shrink-0" />
                <span className="flex-1">Will be renamed to</span>
              </div>
              {files.map((file, i) => (
                <SortableRow
                  key={file}
                  filePath={file}
                  filename={file.split("/").pop() ?? file}
                  episode={episodes[i]}
                  mediaType="movie"
                />
              ))}
            </div>
          ) : (
            seasonOrder.map((sn, groupIdx) => {
              const indices = seasonIndices[sn];
              const isOpen = !collapsed.has(sn);
              return (
                <div key={sn} className="rounded-md border border-border overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/70 text-sm font-medium text-left"
                    onClick={() => toggleSeason(sn)}
                  >
                    {isOpen
                      ? <ChevronDown className="h-4 w-4 shrink-0" />
                      : <ChevronRight className="h-4 w-4 shrink-0" />
                    }
                    {sn === 0 ? "Unmatched" : `Season ${String(sn).padStart(2, "0")}`}
                    <span className="ml-auto text-xs text-muted-foreground font-normal">
                      {indices.length} file{indices.length !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {isOpen && (
                    <>
                      {groupIdx === 0 && (
                        <div className="flex gap-3 px-2 py-1.5 border-b border-border bg-muted/10 text-xs text-muted-foreground">
                          <span className="w-4 shrink-0" />
                          <span className="w-16 shrink-0" />
                          <span className="flex-1">Current filename</span>
                          <span className="w-4 shrink-0" />
                          <span className="flex-1">Will be renamed to</span>
                        </div>
                      )}
                      {indices.map((fileIdx) => (
                        <SortableRow
                          key={files[fileIdx]}
                          filePath={files[fileIdx]}
                          filename={files[fileIdx].split("/").pop() ?? files[fileIdx]}
                          episode={episodes[fileIdx]}
                          mediaType="tv"
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeFile && (
          <div className="flex items-center gap-3 py-2 px-2 rounded-md border border-border bg-background shadow-lg opacity-95">
            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <RowContent
              filePath={activeFile}
              filename={activeFilename}
              episode={activeEpisode}
              mediaType={mediaType}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
