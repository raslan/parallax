import { Loader2, RefreshCw, RotateCcw, StopCircle, Trash2, FolderDown } from "lucide-react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { GalleryDownload } from "@/types/gallery";
import { SectionHeader } from "@/components/SectionHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGalleryDlStatus } from "@/hooks/useGalleryDlStatus";
import { GalleryRow } from "./GalleryRow";

type Filter = "all" | "active" | "done" | "failed";

export function GalleryQueue({
  rows,
  statusFilter,
  onStatusFilterChange,
  onStop,
  onRemove,
  onRetry,
  onStopAll,
  onRetryAllFailed,
  onClearCompleted,
  onClearAll,
}: {
  rows: GalleryDownload[];
  statusFilter: Filter;
  onStatusFilterChange: (f: Filter) => void;
  onStop: (id: number) => void;
  onRemove: (id: number) => void;
  onRetry: (id: number) => void;
  onStopAll: () => void;
  onRetryAllFailed: () => void;
  onClearCompleted: () => void;
  onClearAll: () => void;
}) {
  const gdl = useGalleryDlStatus();
  const [listRef] = useAutoAnimate<HTMLDivElement>();

  const activeCount = rows.filter((r) => r.status === "pending" || r.status === "running").length;
  const hasCompleted = rows.some((r) => r.status === "completed");
  const hasFinished = rows.some((r) => ["completed", "failed", "cancelled"].includes(r.status));
  const hasFailed = rows.some((r) => r.status === "failed" || r.status === "cancelled");

  const filtered = rows.filter((r) => {
    if (statusFilter === "active") return r.status === "pending" || r.status === "running";
    if (statusFilter === "done") return r.status === "completed";
    if (statusFilter === "failed") return r.status === "failed" || r.status === "cancelled";
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SectionHeader>Queue</SectionHeader>
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20"
            >
              {activeCount} active
            </Badge>
          )}
          {rows.length > 0 && (
            <Tabs value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as Filter)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="done">Done</TabsTrigger>
                <TabsTrigger value="failed">Failed</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>

        <div className="flex items-center gap-3">
          {gdl.version && (
            <span className="text-[10px] text-muted-foreground/40 font-mono">
              gallery-dl {gdl.version}
            </span>
          )}
          <button
            onClick={gdl.update}
            disabled={gdl.updating}
            className="text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
            title="Update gallery-dl to latest nightly"
          >
            {gdl.updating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Update
          </button>
          {hasFailed && (
            <button
              onClick={onRetryAllFailed}
              className="text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Retry all failed
            </button>
          )}
          {activeCount > 0 && (
            <button
              onClick={onStopAll}
              className="text-xs text-muted-foreground/50 hover:text-red-400 transition-colors flex items-center gap-1"
            >
              <StopCircle className="h-3 w-3" />
              Stop all
            </button>
          )}
          {hasCompleted && (
            <button
              onClick={onClearCompleted}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              Clear completed
            </button>
          )}
          {hasFinished && (
            <button
              onClick={onClearAll}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border-border/50">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="rounded-full bg-muted/30 p-4">
              <FolderDown className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">No galleries yet</p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                Paste a gallery URL above to get started
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <p className="text-sm text-muted-foreground/50">No {statusFilter} galleries</p>
          </div>
        ) : (
          <div ref={listRef}>
            {filtered.map((row) => (
              <GalleryRow
                key={row.id}
                row={row}
                onStop={onStop}
                onRemove={onRemove}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
