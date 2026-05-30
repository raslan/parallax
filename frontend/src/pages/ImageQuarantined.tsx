import { useState, useEffect, useCallback } from "react";
import { FolderX, Loader2, Trash2, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { imageApi, ImageFile, ImageLibrary } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

// ── Per-library group ─────────────────────────────────────────────────────────

function LibraryGroup({
  libraryName,
  entries,
  onRefresh,
}: {
  libraryName: string;
  entries: ImageFile[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const totalSize = entries.reduce((s, e) => s + e.size, 0);

  const setIdBusy = (id: number, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });

  const handleRestore = async (img: ImageFile) => {
    setIdBusy(img.id, true);
    try {
      await imageApi.restoreImage(img.id);
      onRefresh();
    } catch { /* ignore */ } finally {
      setIdBusy(img.id, false);
    }
  };

  const handleDelete = async (img: ImageFile) => {
    if (!confirm(`Permanently delete "${img.filename}"? This cannot be undone.`)) return;
    setIdBusy(img.id, true);
    try {
      await imageApi.deleteImage(img.id);
      onRefresh();
    } catch { /* ignore */ } finally {
      setIdBusy(img.id, false);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Permanently delete all ${entries.length} images in "${libraryName}"? This cannot be undone.`)) return;
    setDeletingAll(true);
    try {
      await Promise.all(entries.map((img) => imageApi.deleteImage(img.id).catch(() => {})));
      onRefresh();
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
          {open
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm font-medium truncate">{libraryName}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {entries.length} {entries.length === 1 ? "image" : "images"} · {formatSize(totalSize)}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs text-muted-foreground hover:text-destructive shrink-0 ml-4"
          disabled={deletingAll}
          onClick={(e) => { e.stopPropagation(); handleDeleteAll(); }}
        >
          {deletingAll
            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
          Delete all
        </Button>
      </div>

      {open && (
        <CardContent className="pt-0 pb-1 px-0">
          <div className="border-t border-border divide-y divide-border">
            {entries.map((img) => {
              const busy = busyIds.has(img.id);
              return (
                <div key={img.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" title={img.path}>{img.filename}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{img.path}</p>
                  </div>

                  <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
                    {formatSize(img.size)}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Restore image"
                      disabled={busy}
                      onClick={() => handleRestore(img)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Permanently delete image"
                      disabled={busy}
                      onClick={() => handleDelete(img)}
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

export function ImageQuarantined() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [libraries, setLibraries] = useState<ImageLibrary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      imageApi.listQuarantined(1, 10000),
      imageApi.listLibraries(),
    ]).then(([r, libs]) => {
      setImages(r.items);
      setLibraries(libs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const byLibrary = (() => {
    const libMap = Object.fromEntries(libraries.map((l) => [l.id, l.name]));
    const acc: Record<number, { id: number; name: string; entries: ImageFile[] }> = {};
    for (const img of images) {
      if (!acc[img.library_id]) {
        acc[img.library_id] = { id: img.library_id, name: libMap[img.library_id] ?? `Library ${img.library_id}`, entries: [] };
      }
      acc[img.library_id].entries.push(img);
    }
    return Object.values(acc);
  })();

  const totalSize = images.reduce((s, img) => s + img.size, 0);
  const hasEntries = images.length > 0;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader className="mb-1.5">Quarantined images</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Quarantine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Images moved to quarantine from content review. Restore to return them, or delete permanently.
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
      {hasEntries && (
        <div className="grid grid-cols-2 border border-border rounded-[0.4rem] overflow-hidden divide-x divide-border">
          {[
            { label: "Quarantined", value: `${images.length}` },
            { label: "Total size",  value: formatSize(totalSize) },
          ].map(({ label, value }) => (
            <div key={label} className="px-7 py-5">
              <SectionHeader className="mb-2">{label}</SectionHeader>
              <p className="text-2xl font-bold font-mono tabular-nums tracking-tight">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading && !hasEntries ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !hasEntries ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderX className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No quarantined images</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Images flagged in content review will appear here. You can restore or permanently delete them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {byLibrary.map((group) => (
            <LibraryGroup
              key={group.id}
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
