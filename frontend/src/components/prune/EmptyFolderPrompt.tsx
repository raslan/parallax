import { useState } from "react";
import { FolderMinus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * After a file delete empties folders, asks about each one in turn ("Folder is
 * now empty. Delete it?"). `onResolve(path, deleted)` fires per folder (so the
 * page can refetch / react to a failure) and `onClose` once the queue is done.
 * Esc / backdrop counts as Keep for the current folder.
 */
export function EmptyFolderPrompt({
  paths,
  onResolve,
  onClose,
}: {
  paths: string[];
  onResolve: (path: string, deleted: boolean) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const path = paths[index];
  if (path === undefined) return null;

  function advance(deleted: boolean) {
    onResolve(path!, deleted);
    if (index + 1 >= paths.length) onClose();
    else setIndex(index + 1);
  }

  async function remove() {
    setPending(true);
    try {
      // Only if still empty: something may have landed in it since the prompt opened.
      await api.pruneDeleteFolder(path!, true);
      advance(true);
    } catch (e) {
      const msg = getErrorMessage(e, "Could not delete the folder");
      if (msg.startsWith("409") && msg.includes("no longer empty")) {
        toast.info("Folder isn't empty any more — kept");
      } else {
        toast.error(msg);
      }
      advance(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && advance(false)}>
      <DialogContent
        key={path}
        className="max-w-sm animate-slide-up-fade"
        role="dialog"
        aria-label="Empty folder"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderMinus className="h-5 w-5 text-muted-foreground" />
            Empty folder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">Folder is now empty. Delete it?</p>
          <p className="break-words font-medium">{baseName(path)}</p>
          {paths.length > 1 && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {index + 1} of {paths.length}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => advance(false)}>
            Keep
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
