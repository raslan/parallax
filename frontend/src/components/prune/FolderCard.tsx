import type { CSSProperties } from "react";
import { Folder, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { ProgressBar } from "@/components/ProgressBar";
import { Tip } from "@/components/Tip";
import { KIND_ICON } from "@/components/prune/kindIcon";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Counts, FolderNodeInfo } from "@/types/prune";

export type ShareBy = "files" | "size";

/** Item heights the browser hands to `VirtualizedGrid`. */
export const FOLDER_CARD_HEIGHT = 140;
export const FOLDER_ROW_HEIGHT = 60;

const CHIPS: { key: keyof Counts; label: [string, string]; icon: LucideIcon }[] = [
  { key: "images", label: ["image", "images"], icon: KIND_ICON.image },
  { key: "videos", label: ["video", "videos"], icon: KIND_ICON.video },
  { key: "audio", label: ["audio file", "audio files"], icon: KIND_ICON.audio },
  { key: "other", label: ["other file", "other files"], icon: KIND_ICON.other },
];

/** Fraction (0..1) of the parent's total this folder accounts for. */
function shareOf(folder: Counts, parent: Counts, by: ShareBy): number {
  const num = by === "files" ? folder.files : folder.bytes;
  const den = by === "files" ? parent.files : parent.bytes;
  return den > 0 ? Math.min(1, num / den) : 0;
}

function CountChips({ total }: { total: Counts }) {
  const shown = CHIPS.filter((c) => total[c.key] > 0);
  if (shown.length === 0) {
    return <span className="text-2xs text-muted-foreground">Empty</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map(({ key, label, icon: Icon }) => {
        const n = total[key];
        return (
          <Tip key={key} label={`${n.toLocaleString()} ${label[n === 1 ? 0 : 1]}`}>
            <span className="inline-flex items-center gap-1 rounded-sm border bg-background/40 px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
              <Icon className="h-3 w-3" />
              {n.toLocaleString()}
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

function ShareBar({ share, by, className }: { share: number; by: ShareBy; className?: string }) {
  const pct = Math.round(share * 100);
  const label = `${pct < 1 && share > 0 ? "<1" : pct}% of this folder's ${by === "files" ? "files" : "size"}`;
  return (
    <Tip label={label}>
      <ProgressBar
        value={share * 100}
        label={label}
        className={cn("h-1", className)}
        barClassName="bg-primary/80"
      />
    </Tip>
  );
}

/**
 * One subfolder of the open folder, as a grid card or a list row. The whole
 * surface opens the folder; the trash action sits over it and is revealed on
 * hover/focus (always visible on touch). Props-in/callbacks-out.
 */
export function FolderCard({
  folder,
  parentTotal,
  shareBy,
  layout,
  index,
  leaving = false,
  onOpen,
  onDelete,
}: {
  folder: FolderNodeInfo;
  parentTotal: Counts;
  shareBy: ShareBy;
  layout: "grid" | "list";
  /** Position in the list; drives the staggered enter delay (capped). */
  index: number;
  /** Plays the delete exit animation. */
  leaving?: boolean;
  onOpen: (path: string) => void;
  onDelete?: (folder: FolderNodeInfo) => void;
}) {
  const exit = leaving
    ? "pointer-events-none scale-95 opacity-0 transition-[transform,opacity] duration-150 ease-in motion-reduce:scale-100"
    : "";
  const share = shareOf(folder.total, parentTotal, shareBy);
  const files = folder.total.files;
  // Position for the shared `stagger` utility (index.css), which caps and spaces the delay.
  const style = { "--stagger": index } as CSSProperties;
  const trash = onDelete && (
    <IconButton
      label={`Delete ${folder.name}`}
      onClick={() => onDelete(folder)}
      className={cn(
        "absolute z-10 flex h-7 w-7 items-center justify-center rounded-md border bg-px-elevated text-muted-foreground opacity-0 transition-[opacity,color,border-color] duration-100",
        "hover:border-destructive/50 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100",
        layout === "grid" ? "right-2 top-2" : "right-3 top-1/2 -translate-y-1/2",
      )}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </IconButton>
  );

  if (layout === "list") {
    return (
      <div
        className={cn(
          "group relative h-full animate-slide-up-fade stagger border-b last:border-b-0",
          exit,
        )}
        style={style}
      >
        <button
          type="button"
          onClick={() => onOpen(folder.path)}
          className="flex h-full w-full items-center gap-3 px-3 pr-14 text-left transition-colors duration-100 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-hidden"
        >
          <Folder className="h-4 w-4 shrink-0 text-primary/80" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{folder.name}</span>
            <ShareBar share={share} by={shareBy} className="mt-1.5 max-w-48" />
          </span>
          <span className="hidden shrink-0 md:block">
            <CountChips total={folder.total} />
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums">
            {files.toLocaleString()}
            <span className="ml-1 text-muted-foreground">{files === 1 ? "file" : "files"}</span>
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {formatSize(folder.total.bytes)}
          </span>
        </button>
        {trash}
      </div>
    );
  }

  return (
    <div className={cn("group relative h-full animate-slide-up-fade stagger", exit)} style={style}>
      <button
        type="button"
        onClick={() => onOpen(folder.path)}
        className="flex h-full w-full flex-col gap-2 rounded-lg border bg-px-elevated p-3 text-left transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/50 focus-visible:-translate-y-0.5 focus-visible:border-primary/60 focus-visible:outline-hidden"
      >
        <div className="flex items-start gap-2 pr-8">
          <Folder className="mt-0.5 h-4 w-4 shrink-0 text-primary/80 transition-transform duration-150 group-hover:scale-110" />
          <Tip label={folder.name}>
            <span className="line-clamp-2 min-w-0 text-sm font-medium leading-snug break-words">
              {folder.name}
            </span>
          </Tip>
        </div>
        <CountChips total={folder.total} />
        <div className="mt-auto space-y-1.5">
          <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
            <span>
              {files.toLocaleString()}
              <span className="ml-1 text-muted-foreground">{files === 1 ? "file" : "files"}</span>
            </span>
            <span className="text-muted-foreground">{formatSize(folder.total.bytes)}</span>
          </div>
          <ShareBar share={share} by={shareBy} />
        </div>
      </button>
      {trash}
    </div>
  );
}
