import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, qk } from "@/lib/api";
import type { Job } from "@/types/job";
import { formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";
import { DeleteLibraryDialog } from "./DeleteLibraryDialog";
import { DeleteAllLibrariesDialog } from "./DeleteAllLibrariesDialog";
import type { LibraryBase, LibraryKind } from "./types";

/**
 * Shared list page behind both `/` (video libraries) and `/images` (image
 * libraries). Everything that differs comes in through `kind` — see
 * `./types.ts` and the two `pages/*.tsx` config objects.
 */
export function LibraryManagerPage<T extends LibraryBase>({ kind }: { kind: LibraryKind<T> }) {
  const queryClient = useQueryClient();
  const [deletingLib, setDeletingLib] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  const { data: libraries = [], isLoading: loading } = useQuery<T[]>({
    queryKey: kind.listKey(),
    queryFn: () => kind.list(),
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
      active
        .filter((j) => j.type === kind.jobType && j.library_id != null)
        .map((j) => j.library_id!),
    );
  }, [jobs, kind.jobType]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: kind.listKey() });
    queryClient.invalidateQueries({ queryKey: qk.jobs() });
  };

  const { ScanControl, AddDialog } = kind;
  const EmptyIcon = kind.emptyIcon;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader className="mb-1.5">{kind.sectionLabel}</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">{kind.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{kind.subtitle(libraries)}</p>
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
        kind={kind}
        lib={deletingLib}
        onClose={() => setDeletingLib(null)}
        onDeleted={refresh}
      />
      <DeleteAllLibrariesDialog
        kind={kind}
        open={deleteAllOpen}
        onClose={() => setDeleteAllOpen(false)}
        libraries={libraries}
        onDeleted={refresh}
      />
      <AddDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={refresh} />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : libraries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <EmptyIcon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">{kind.emptyTitle}</h3>
            <p className="text-sm text-muted-foreground max-w-sm">{kind.emptyBody}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraries.map((lib) => {
            const count = kind.getCount(lib);
            return (
              <Card key={lib.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{lib.name}</CardTitle>
                    <div className="flex gap-1 shrink-0 items-center relative">
                      <ScanControl
                        libraryId={lib.id}
                        scanning={scanningIds.has(lib.id)}
                        onScanned={refresh}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeletingLib(lib)}
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
                    <span className="truncate font-mono">{lib.path}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {count > 0 ? (
                      <>
                        <span className="font-mono">{count.toLocaleString()}</span> {kind.countNoun}
                      </>
                    ) : (
                      `No ${kind.countNoun} indexed`
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {kind.isScanned(lib)
                      ? `Last scanned: ${formatDate(lib.last_scanned_at)}`
                      : kind.notScannedHint}
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
