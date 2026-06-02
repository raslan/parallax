import { useEffect, useState, useCallback } from "react";
import { Archive, Loader2, Trash2, RotateCcw, ArrowRight, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, Original, OriginalsSummary } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

// ── Savings badge ─────────────────────────────────────────────────────────────

function SavingsBadge({ bytes }: { bytes: number | null }) {
  if (bytes === null) return null;
  if (bytes > 0) {
    return (
      <Badge variant="secondary" className="text-xs text-primary border-primary/20 bg-primary/10 tabular-nums">
        −{formatSize(bytes)}
      </Badge>
    );
  }
  if (bytes < 0) {
    return (
      <Badge variant="secondary" className="text-xs text-amber-400 border-amber-400/20 bg-amber-400/10 tabular-nums">
        +{formatSize(Math.abs(bytes))}
      </Badge>
    );
  }
  return null;
}

// ── Per-library group ─────────────────────────────────────────────────────────

function LibraryGroup({
  libraryId,
  libraryName,
  entries,
  onRefresh,
}: {
  libraryId: number;
  libraryName: string;
  entries: Original[];
  onRefresh: () => void;
}) {
  const [open, setOpen]           = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);
  const [restoringAll, setRestoringAll] = useState(false);
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());

  const totalSavings  = entries.reduce((s, e) => s + (e.savings_bytes ?? 0), 0);
  const totalOrigSize = entries.reduce((s, e) => s + e.original_size, 0);

  const setPathBusy = (path: string, busy: boolean) =>
    setBusyPaths((prev) => {
      const next = new Set(prev);
      busy ? next.add(path) : next.delete(path);
      return next;
    });

  const handleDelete = async (path: string) => {
    setPathBusy(path, true);
    try {
      await api.deleteOriginal(path);
      onRefresh();
    } catch { /* ignore */ } finally {
      setPathBusy(path, false);
    }
  };

  const handleRestore = async (path: string) => {
    if (!confirm("Restore this original? The modified file will be replaced.")) return;
    setPathBusy(path, true);
    try {
      await api.restoreOriginal(path);
      onRefresh();
    } catch { /* ignore */ } finally {
      setPathBusy(path, false);
    }
  };

  const handleRestoreAll = async () => {
    if (!confirm(`Restore all ${entries.length} originals for "${libraryName}"? All modified files will be replaced.`)) return;
    setRestoringAll(true);
    try {
      await Promise.all(entries.map((e) => api.restoreOriginal(e.path).catch(() => {})));
      onRefresh();
    } finally {
      setRestoringAll(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Delete all ${entries.length} originals for "${libraryName}"? This cannot be undone.`)) return;
    setDeletingAll(true);
    try {
      await api.deleteLibraryOriginals(libraryId);
      onRefresh();
    } catch { /* ignore */ } finally {
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
          {open
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm font-medium truncate">{libraryName}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {entries.length} {entries.length === 1 ? "backup" : "backups"} · {formatSize(totalOrigSize)}
          </span>
          {totalSavings > 0 && (
            <span className="text-xs text-primary shrink-0">· {formatSize(totalSavings)} recoverable</span>
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
            {restoringAll
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Restore all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-destructive"
            disabled={deletingAll || restoringAll}
            onClick={handleDeleteAll}
          >
            {deletingAll
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
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
                <div key={entry.path} className="flex items-center gap-4 px-5 py-3">
                  {/* Filename */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" title={entry.path}>{entry.filename}</p>
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
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Restore original (replaces modified file)"
                      disabled={busy}
                      onClick={() => handleRestore(entry.path)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Delete original (frees disk space)"
                      disabled={busy}
                      onClick={() => handleDelete(entry.path)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Originals() {
  const [summary, setSummary] = useState<OriginalsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getOriginals()
      .then(setSummary)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group entries by library
  const byLibrary = summary
    ? Object.values(
        summary.entries.reduce<Record<number, { id: number; name: string; entries: Original[] }>>(
          (acc, e) => {
            if (!acc[e.library_id]) acc[e.library_id] = { id: e.library_id, name: e.library_name, entries: [] };
            acc[e.library_id].entries.push(e);
            return acc;
          },
          {}
        )
      )
    : [];

  const hasEntries = (summary?.entries.length ?? 0) > 0;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader className="mb-1.5">Backups of modified files</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Originals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Backup files kept from before modifications. Delete once you're happy, or restore to undo.
          </p>
        </div>
        <button
          onClick={load}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : "opacity-0"}`} />
        </button>
      </div>

      {/* Summary stats */}
      {summary && hasEntries && (
        <div className="grid grid-cols-3 border border-border rounded-[0.4rem] overflow-hidden divide-x divide-border">
          {[
            { label: "Backups",          value: `${summary.entries.length}` },
            { label: "Backup storage",   value: formatSize(summary.total_original_bytes) },
            {
              label: summary.total_savings_bytes >= 0 ? "Space recoverable" : "Extra space used",
              value: formatSize(Math.abs(summary.total_savings_bytes)),
              accent: summary.total_savings_bytes > 0,
            },
          ].map(({ label, value, accent }) => (
            <div key={label} className="px-7 py-5">
              <SectionHeader className="mb-2">{label}</SectionHeader>
              <p className={`text-2xl font-bold font-mono tabular-nums tracking-tight ${accent ? "text-primary" : ""}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading && !summary ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !hasEntries ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Archive className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No originals</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Original files will appear here after modification. They're kept as backups until you delete them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {byLibrary.map((group) => (
            <LibraryGroup
              key={group.id}
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
