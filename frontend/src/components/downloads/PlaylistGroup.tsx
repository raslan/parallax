import { useState } from "react";
import { ChevronDown, ChevronUp, Folder } from "lucide-react";
import type { DownloadItem } from "@/types/download";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { DownloadCard } from "./DownloadCard";

export function PlaylistGroup({
  title,
  items,
  onPlay,
  onClear,
  onDeleteFile,
  onRetry,
}: {
  title: string;
  items: DownloadItem[];
  onPlay: (item: DownloadItem) => void;
  onClear: (id: number) => void;
  onDeleteFile: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const total = items.length;
  const done = items.filter((i) => i.status === "completed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const active = items.filter((i) => i.status === "pending" || i.status === "running").length;

  const overallPct =
    total > 0
      ? Math.round(
          items.reduce((sum, i) => sum + (i.status === "completed" ? 100 : i.progress), 0) / total,
        )
      : 0;

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors text-left group"
      >
        <Folder className="h-3.5 w-3.5 text-primary/70 shrink-0" />
        <span className="flex-1 text-sm font-medium text-foreground/90 truncate">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {active > 0 && (
            <span className="text-[10px] text-primary font-mono tabular-nums">{overallPct}%</span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {done}/{total}
            {failed > 0 && <span className="text-red-400 ml-1">({failed} failed)</span>}
          </span>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="pl-4 border-l border-border/30 ml-4">
          <VirtualizedGrid
            items={items}
            getKey={(item) => item.id}
            mode="list"
            itemHeight={92}
            dynamicHeight
            maxHeight="50vh"
            renderItem={(item) => (
              <DownloadCard
                item={item}
                onPlay={onPlay}
                onClear={onClear}
                onDeleteFile={onDeleteFile}
                onRetry={onRetry}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}
