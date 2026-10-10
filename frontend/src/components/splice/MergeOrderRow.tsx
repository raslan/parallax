import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Star, X } from "lucide-react";
import type { VideoFile } from "@/types/file";
import type { SplicePreflightFile } from "@/types/splice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MergeOrderRow({
  file,
  position,
  info,
  isReference,
  showReferencePick,
  onRemove,
  onPickReference,
}: {
  file: VideoFile;
  position: number;
  info: SplicePreflightFile | undefined;
  isReference: boolean;
  showReferencePick: boolean;
  onRemove: () => void;
  onPickReference: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: file.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b border-border bg-[var(--px-bg-base)] px-2 py-2 last:border-0",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {position}
      </span>
      <div className="relative h-9 w-16 shrink-0">
        <VideoThumbnail
          fileId={file.id}
          scannedAt={file.scanned_at}
          alt={file.filename}
          imgClassName="h-9 w-16 object-cover rounded"
          iconClassName="h-3.5 w-3.5 text-muted-foreground/40"
          fallbackClassName="h-9 w-16 bg-muted rounded"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={file.filename}>
          {file.filename}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(file.duration)}
          </span>
          {info?.reasons.map((r) => (
            <Badge
              key={r}
              variant="outline"
              className="border-orange-500/40 px-1.5 py-0 text-[10px] text-orange-400"
            >
              {r}
            </Badge>
          ))}
        </div>
      </div>
      {showReferencePick && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onPickReference}
          title={isReference ? "Reference format" : "Use as reference format"}
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              isReference ? "fill-primary text-primary" : "text-muted-foreground",
            )}
          />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        onClick={onRemove}
        title="Remove from merge"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
