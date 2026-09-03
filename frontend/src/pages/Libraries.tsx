import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Library as LibIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Plus,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { api, qk } from "@/lib/api";
import type { Library } from "@/types/library";
import type { Job } from "@/types/job";
import { formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";
import { DirPicker } from "@/components/DirPicker";

interface Leftovers {
  has_leftovers: boolean;
  dir_name: string;
  count: number;
  total_bytes: number;
}

function DeleteLibraryDialog({
  lib,
  onClose,
  onDeleted,
}: {
  lib: Library | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const { data: leftovers } = useQuery<Leftovers>({
    queryKey: lib ? qk.libraryLeftovers(lib.id) : ["libraries", "none", "leftovers"],
    queryFn: () => api.libraryLeftovers(lib!.id),
    enabled: !!lib,
  });

  const doDelete = async (deleteLeftovers: boolean) => {
    if (!lib) return;
    setDeleting(true);
    try {
      await api.deleteLibrary(lib.id, deleteLeftovers);
      onDeleted(lib.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!lib} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Delete library</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Remove <span className="font-medium text-foreground">{lib?.name || lib?.path}</span> and
            all its file records from Parallax. Files on disk are not touched.
          </p>
          {leftovers?.has_leftovers && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-amber-400">
                {leftovers.count} file{leftovers.count !== 1 ? "s" : ""} in{" "}
                <code className="font-mono text-xs">_originals/</code>
              </p>
              <p className="text-xs text-muted-foreground">
                {(leftovers.total_bytes / 1024 ** 3).toFixed(2)} GB of original backups found. What
                should happen to them?
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {leftovers?.has_leftovers ? (
            <>
              <Button
                variant="destructive"
                onClick={() => doDelete(true)}
                disabled={deleting}
                className="w-full justify-start"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete library and originals
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate("/originals");
                }}
                className="w-full justify-start"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Review originals first
              </Button>
              <Button
                variant="outline"
                onClick={() => doDelete(false)}
                disabled={deleting}
                className="w-full justify-start"
              >
                Keep originals on disk
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={() => doDelete(false)}
                disabled={deleting}
                className="w-full"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete library
              </Button>
              <Button variant="outline" onClick={onClose} className="w-full">
                Cancel
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAllLibrariesDialog({
  open,
  onClose,
  libraries,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  libraries: Library[];
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const { data: totals, isFetching: checking } = useQuery({
    queryKey: ["libraries", "leftovers-all", libraries.map((l) => l.id).sort()],
    queryFn: async () => {
      const results = await Promise.all(
        libraries.map((l) => api.libraryLeftovers(l.id).catch(() => null)),
      );
      return {
        count: results.reduce((s, r) => s + (r?.has_leftovers ? r.count : 0), 0),
        bytes: results.reduce((s, r) => s + (r?.has_leftovers ? r.total_bytes : 0), 0),
      };
    },
    enabled: open && libraries.length > 0,
  });
  const totalCount = totals?.count ?? 0;
  const totalBytes = totals?.bytes ?? 0;

  const doDeleteAll = async (deleteLeftovers: boolean) => {
    setDeleting(true);
    try {
      await Promise.all(
        libraries.map((l) => api.deleteLibrary(l.id, deleteLeftovers).catch(() => {})),
      );
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const hasLeftovers = totalCount > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Delete all libraries</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Remove all <span className="font-medium text-foreground">{libraries.length}</span>{" "}
            libraries and their file records from Parallax. Files on disk are not touched.
          </p>
          {checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {!checking && hasLeftovers && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-amber-400">
                {totalCount} file{totalCount !== 1 ? "s" : ""} in{" "}
                <code className="font-mono text-xs">_originals/</code>
              </p>
              <p className="text-xs text-muted-foreground">
                {(totalBytes / 1024 ** 3).toFixed(2)} GB of original backups found across libraries.
                What should happen to them?
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!checking && hasLeftovers ? (
            <>
              <Button
                variant="destructive"
                onClick={() => doDeleteAll(true)}
                disabled={deleting}
                className="w-full justify-start"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete all libraries and originals
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate("/originals");
                }}
                className="w-full justify-start"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Review originals first
              </Button>
              <Button
                variant="outline"
                onClick={() => doDeleteAll(false)}
                disabled={deleting}
                className="w-full justify-start"
              >
                Keep originals on disk
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={() => doDeleteAll(false)}
                disabled={deleting || checking}
                className="w-full"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete all libraries
              </Button>
              <Button variant="outline" onClick={onClose} className="w-full">
                Cancel
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [path, setPath] = useState("");
  const [split, setSplit] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const parts = path.trim().split("/").filter(Boolean);
  const derivedName = parts.length > 0 ? parts[parts.length - 1] : "";

  const reset = () => {
    setPath("");
    setSplit(false);
    setAutoScan(true);
    setPicking(false);
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    try {
      const created = await api.createLibrary({
        name: derivedName,
        path: path.trim(),
        split_into_sublibraries: split,
      });
      if (autoScan) {
        await Promise.all(created.map((lib) => api.scanLibrary(lib.id).catch(() => {})));
      }
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create library";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Add Library</DialogTitle>
        </DialogHeader>
        {picking ? (
          <DirPicker
            onSelect={(p) => {
              setPath(p);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Path</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="/media/movies"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPicking(true)}
                  title="Browse"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">Split into sub-libraries</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create one library per immediate subdirectory, named after each folder. Files
                  belong only to their parent folder's library.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScan}
                onChange={(e) => setAutoScan(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">Scan after creation</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically index files as soon as the library is created.
                </p>
              </div>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {split ? "Add Libraries" : "Add Library"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Libraries() {
  const queryClient = useQueryClient();
  const [deletingLib, setDeletingLib] = useState<Library | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  const { data: libraries = [], isLoading: loading } = useQuery<Library[]>({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
    refetchInterval: 5000,
  });
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchInterval: 5000,
  });

  const scanningIds = useMemo(() => {
    const active = jobs.filter((j) => j.status === "pending" || j.status === "running");
    return new Set(
      active.filter((j) => j.type === "scan" && j.library_id != null).map((j) => j.library_id!),
    );
  }, [jobs]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.libraries() });
    queryClient.invalidateQueries({ queryKey: qk.jobs() });
  };

  const handleScan = async (id: number) => {
    try {
      await api.scanLibrary(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("409")) throw e;
    }
    refresh();
  };

  const handleDelete = (id: number) => {
    const lib = libraries.find((l) => l.id === id) ?? null;
    setDeletingLib(lib);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader className="mb-1.5">Media collection</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Libraries</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage the folders you want to scan.</p>
        </div>
        <div className="flex gap-2">
          {libraries.length > 0 && (
            <Button variant="outline" onClick={() => setDeleteAllOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete all
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Library
          </Button>
        </div>
      </div>

      <DeleteLibraryDialog
        lib={deletingLib}
        onClose={() => setDeletingLib(null)}
        onDeleted={() => refresh()}
      />
      <DeleteAllLibrariesDialog
        open={deleteAllOpen}
        onClose={() => setDeleteAllOpen(false)}
        libraries={libraries}
        onDeleted={() => refresh()}
      />
      <AddLibraryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => refresh()}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : libraries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <LibIcon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No libraries</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add a folder from your mounted volumes to start scanning.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraries.map((lib) => {
            return (
              <Card key={lib.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{lib.name}</CardTitle>
                    <div className="flex gap-1 shrink-0 items-center relative">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleScan(lib.id)}
                        disabled={scanningIds.has(lib.id)}
                        title="Scan for new / removed files"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${scanningIds.has(lib.id) ? "animate-spin" : ""}`}
                        />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(lib.id)}
                        title="Delete library"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{lib.path}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {lib.file_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{lib.file_count.toLocaleString()}</span> files
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lib.file_count === 0
                      ? "Not yet scanned — click the refresh icon to index files"
                      : `Last scanned: ${formatDate(lib.last_scanned_at)}`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
