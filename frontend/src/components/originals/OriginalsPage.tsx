import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Loader2,
  Trash2,
  RotateCcw,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { RowContextMenu, buildRowActions } from "@/components/RowMenu";
import { QueryError } from "@/components/QueryError";
import { ListSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSize, describeSelection } from "@/lib/format";
import { StatPanel } from "@/components/StatPanel";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import { Tip } from "@/components/Tip";
import type { Original as OriginalEntry } from "@/types/original";
import { PageTitle } from "@/components/PageTitle";

// ── Kind config ───────────────────────────────────────────────────────────────
// A TS shape (API fns + copy) — NOT the backend `OriginalsKind` dataclass. The
// video and audio Originals pages each pass one of these; the page body below is
// identical between them. `OriginalEntry` (video's `Original`) is structurally
// shared with the audio entry shape.

export interface OriginalsKind {
  title: string;
  subtitle: string;
  listKey: (libraryId?: number) => readonly unknown[];
  list: (libraryId?: number) => Promise<{
    entries: OriginalEntry[];
    total_original_bytes: number;
    total_current_bytes: number;
    total_savings_bytes: number;
  }>;
  restore: (path: string) => Promise<unknown>;
  restoreBatch: (
    paths: string[],
  ) => Promise<{ restored: number; failed: { path: string; error: string }[] }>;
  deleteFile: (path: string) => Promise<unknown>;
  deleteLibraryOriginals: (libraryId: number) => Promise<unknown>;
}

// ── Savings badge ─────────────────────────────────────────────────────────────

function SavingsBadge({ bytes }: { bytes: number | null }) {
  if (bytes === null) return null;
  if (bytes > 0) {
    return (
      <Badge
        variant="secondary"
        className="text-xs text-primary border-primary/20 bg-primary/10 tabular-nums"
      >
        −{formatSize(bytes)}
      </Badge>
    );
  }
  if (bytes < 0) {
    return (
      <Badge
        variant="secondary"
        className="text-xs text-amber-400 border-amber-400/20 bg-amber-400/10 tabular-nums"
      >
        +{formatSize(Math.abs(bytes))}
      </Badge>
    );
  }
  return null;
}

// ── Per-library group ─────────────────────────────────────────────────────────

function LibraryGroup({
  kind,
  libraryId,
  libraryName,
  entries,
  onRefresh,
}: {
  kind: OriginalsKind;
  libraryId: number;
  libraryName: string;
  entries: OriginalEntry[];
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);
  const [restoringAll, setRestoringAll] = useState(false);
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());

  const totalSavings = entries.reduce((s, e) => s + (e.savings_bytes ?? 0), 0);
  const totalOrigSize = entries.reduce((s, e) => s + e.original_size, 0);

  const setPathBusy = (path: string, busy: boolean) => {
    setBusyPaths((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  };

  const handleDelete = async (path: string) => {
    setPathBusy(path, true);
    try {
      await kind.deleteFile(path);
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setPathBusy(path, false);
    }
  };

  const handleRestore = async (path: string) => {
    if (
      !(await confirm({
        title: "Restore original?",
        description: "Restore this original? The modified file will be replaced.",
        confirmText: "Restore",
      }))
    )
      return;
    setPathBusy(path, true);
    try {
      await kind.restore(path);
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setPathBusy(path, false);
    }
  };

  const handleRestoreAll = async () => {
    if (
      !(await confirm({
        title: "Restore all originals?",
        description: `Restore all ${entries.length} originals for "${libraryName}"? All modified files will be replaced.`,
        confirmText: "Restore all",
      }))
    )
      return;
    setRestoringAll(true);
    try {
      await kind.restoreBatch(entries.map((e) => e.path));
      onRefresh();
    } finally {
      setRestoringAll(false);
    }
  };

  const handleDeleteAll = async () => {
    if (
      !(await confirm({
        title: "Delete all originals?",
        description: `Delete all ${describeSelection(
          entries.length,
          "original",
          entries.reduce((sum, e) => sum + e.original_size, 0),
        )} for "${libraryName}"? This cannot be undone.`,
        confirmText: "Delete all",
        destructive: true,
      }))
    )
      return;
    setDeletingAll(true);
    try {
      await kind.deleteLibraryOriginals(libraryId);
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <Card>
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium truncate">{libraryName}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {entries.length} {entries.length === 1 ? "backup" : "backups"} ·{" "}
            {formatSize(totalOrigSize)}
          </span>
          {totalSavings > 0 && (
            <span className="text-xs text-primary shrink-0">
              · {formatSize(totalSavings)} recoverable
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-4" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-foreground"
            disabled={restoringAll || deletingAll}
            onClick={handleRestoreAll}
          >
            {restoringAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Restore all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-destructive"
            disabled={deletingAll || restoringAll}
            onClick={handleDeleteAll}
          >
            {deletingAll ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            Delete all
          </Button>
        </div>
      </div>

      {open && (
        <CardContent className="pt-0 pb-1 px-0">
          <div className="border-t border-border divide-y divide-border">
            {entries.map((entry) => {
              const busy = busyPaths.has(entry.path);
              const missing = entry.current_path === null;
              return (
                <RowContextMenu
                  key={entry.path}
                  actions={buildRowActions({
                    path: entry.path,
                    extra: [
                      {
                        label: "Restore original",
                        icon: RotateCcw,
                        onSelect: () => handleRestore(entry.path),
                      },
                      {
                        label: "Delete original",
                        icon: Trash2,
                        onSelect: () => handleDelete(entry.path),
                        destructive: true,
                        separatorBefore: true,
                      },
                    ],
                  })}
                >
                  <div className="flex items-center gap-4 px-5 py-3">
                    {/* Filename */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" title={entry.path}>
                        {entry.filename}
                      </p>
                      {missing && (
                        <p className="text-xs text-amber-400 flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="h-3 w-3" /> Modified file missing
                        </p>
                      )}
                    </div>

                    {/* Size comparison */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 tabular-nums">
                      <span className="font-mono">{formatSize(entry.original_size)}</span>
                      {entry.current_size !== null && (
                        <>
                          <ArrowRight className="h-3 w-3" />
                          <span className="font-mono">{formatSize(entry.current_size)}</span>
                        </>
                      )}
                    </div>

                    <SavingsBadge bytes={entry.savings_bytes} />

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Tip label="Restore original (replaces modified file)">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          aria-label="Restore original"
                          disabled={busy}
                          onClick={() => handleRestore(entry.path)}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </Tip>
                      <Tip label="Delete original (frees disk space)">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          aria-label="Delete original"
                          disabled={busy}
                          onClick={() => handleDelete(entry.path)}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </Tip>
                    </div>
                  </div>
                </RowContextMenu>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OriginalsPage({ kind }: { kind: OriginalsKind }) {
  const {
    data: summary = null,
    isLoading: loading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: kind.listKey(),
    queryFn: () => kind.list(),
    refetchOnMount: "always",
  });
  const load = () => {
    refetch();
  };

  // Group entries by library
  const byLibrary = summary
    ? Object.values(
        summary.entries.reduce<
          Record<number, { id: number; name: string; entries: OriginalEntry[] }>
        >((acc, e) => {
          if (!acc[e.library_id])
            acc[e.library_id] = { id: e.library_id, name: e.library_name, entries: [] };
          acc[e.library_id]!.entries.push(e);
          return acc;
        }, {}),
      )
    : [];

  const hasEntries = (summary?.entries.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <PageTitle>{kind.title}</PageTitle>
          <p className="text-sm text-muted-foreground mt-1">{kind.subtitle}</p>
        </div>
        <IconButton
          label="Refresh"
          onClick={load}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Loader2 className={`h-4 w-4 ${isFetching ? "animate-spin" : "opacity-0"}`} />
        </IconButton>
      </div>

      {/* Summary stats */}
      {summary && hasEntries && (
        <StatPanel
          stats={[
            { label: "Backups", value: `${summary.entries.length}` },
            { label: "Backup storage", value: formatSize(summary.total_original_bytes) },
            {
              label: summary.total_savings_bytes >= 0 ? "Space recoverable" : "Extra space used",
              value: formatSize(Math.abs(summary.total_savings_bytes)),
              accent: summary.total_savings_bytes > 0,
            },
          ]}
        />
      )}

      {/* Content */}
      {loading && !summary ? (
        <ListSkeleton rows={5} />
      ) : error && !summary ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : !hasEntries ? (
        <EmptyState
          icon={Archive}
          title="No originals"
          description="Original files will appear here after modification. They're kept as backups until you delete them."
        />
      ) : (
        <div className="space-y-3">
          {byLibrary.map((group) => (
            <LibraryGroup
              key={group.id}
              kind={kind}
              libraryId={group.id}
              libraryName={group.name}
              entries={group.entries}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
