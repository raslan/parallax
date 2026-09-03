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
import type { Leftovers, LibraryBase, LibraryKind } from "./types";

export function DeleteLibraryDialog<T extends LibraryBase>({
  kind,
  lib,
  onClose,
  onDeleted,
}: {
  kind: LibraryKind<T>;
  lib: T | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const { data: leftovers } = useQuery<Leftovers>({
    queryKey: lib ? kind.leftoversKey(lib.id) : [...kind.listKey(), "none", "leftovers"],
    queryFn: () => kind.leftovers(lib!.id),
    enabled: !!lib,
  });

  const doDelete = async (deleteLeftovers: boolean) => {
    if (!lib) return;
    setDeleting(true);
    try {
      await kind.remove(lib.id, deleteLeftovers);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!lib} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Delete {kind.entityLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Remove <span className="font-medium text-foreground">{lib?.name || lib?.path}</span> and
            all its {kind.recordNoun} from Parallax. Files on disk are not touched.
          </p>
          {leftovers?.has_leftovers && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-amber-400">
                {leftovers.count} file{leftovers.count !== 1 ? "s" : ""} in{" "}
                <code className="font-mono text-xs">{kind.leftoverDir}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                {(leftovers.total_bytes / 1024 ** 3).toFixed(2)} GB of {kind.leftoverFoundNoun}{" "}
                found. What should happen to them?
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
                {kind.leftoverButtons.deleteWith}
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
                onClick={() => doDelete(false)}
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
                onClick={() => doDelete(false)}
                disabled={deleting}
                className="w-full"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete {kind.entityLabel}
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
