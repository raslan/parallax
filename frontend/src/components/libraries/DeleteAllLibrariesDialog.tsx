import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryBase, LibraryKind } from "./types";

export function DeleteAllLibrariesDialog<T extends LibraryBase>({
  kind,
  open,
  onClose,
  libraries,
  onDeleted,
}: {
  kind: LibraryKind<T>;
  open: boolean;
  onClose: () => void;
  libraries: T[];
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const { data: totals, isFetching: checking } = useQuery({
    queryKey: [...kind.listKey(), "leftovers-all", libraries.map((l) => l.id).sort()],
    queryFn: async () => {
      const results = await Promise.all(
        libraries.map((l) => kind.leftovers(l.id).catch(() => null)),
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
      await Promise.all(libraries.map((l) => kind.remove(l.id, deleteLeftovers).catch(() => {})));
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
          <DialogTitle>Delete all {kind.entityPlural}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Remove all <span className="font-medium text-foreground">{libraries.length}</span>{" "}
            libraries and their {kind.recordNoun} from Parallax. Files on disk are not touched.
          </p>
          {checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {!checking && hasLeftovers && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-amber-400">
                {totalCount} file{totalCount !== 1 ? "s" : ""} in{" "}
                <code className="font-mono text-xs">{kind.leftoverDir}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                {(totalBytes / 1024 ** 3).toFixed(2)} GB of {kind.leftoverFoundNoun} found across
                libraries. What should happen to them?
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
                {kind.leftoverButtons.deleteAllWith}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate(kind.leftoverReviewRoute);
                }}
                className="w-full justify-start"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                {kind.leftoverButtons.reviewFirst}
              </Button>
              <Button
                variant="outline"
                onClick={() => doDeleteAll(false)}
                disabled={deleting}
                className="w-full justify-start"
              >
                {kind.leftoverButtons.keepOnDisk}
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
                Delete all {kind.entityPlural}
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
