import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage, httpStatus } from "@/lib/api/client";
import { describeSelection, sumSizeOf } from "@/lib/format";
import { DELETE_CHUNK, deleteInChunks } from "@/lib/pruneDelete";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PruneDeleteResult, PruneFile } from "@/types/prune";

const MAX_NAMES = 8;

/**
 * Plain confirmation for deleting the selected files. The dialog performs the
 * call and hands the raw response to `onResult`; the page reconciles selection
 * (deleted leave it, failed stay selected so nothing is lost when this closes)
 * and opens the empty-folder prompt. Failures are toasted here.
 */
export function DeleteFilesDialog({
  files,
  onClose,
  onResult,
  onError,
  onPendingChange,
}: {
  /** The selected files; an empty list keeps the dialog closed. */
  files: PruneFile[];
  onClose: () => void;
  onResult: (result: PruneDeleteResult) => void;
  onError?: (error: unknown) => void;
  /** Fires when the delete call starts and ends (the page's "Deleting…" button). */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [pending, setPendingState] = useState(false);
  /** Paths sent so far while a multi-chunk delete runs. */
  const [sent, setSent] = useState(0);
  if (files.length === 0) return null;

  const count = files.length;
  const paths = files.map((f) => f.path);
  const bytes = sumSizeOf(files, new Set(paths), (f) => f.path);
  const what = describeSelection(count, "file");
  const names = new Map(files.map((f) => [f.path, f.name]));
  const chunked = count > DELETE_CHUNK;

  function setPending(p: boolean) {
    setPendingState(p);
    onPendingChange?.(p);
  }

  async function run() {
    setPending(true);
    setSent(0);
    try {
      // Sequential chunks of 500; stops at the first failed chunk and still
      // reports what that run already deleted.
      const { result, error } = await deleteInChunks(
        paths,
        (chunk) => api.pruneDelete(chunk),
        setSent,
      );
      const anything = result.deleted.length + result.failed.length + result.empty_folders.length;
      if (error !== null) {
        if (anything > 0) report(result);
        throw error;
      }
      report(result);
    } catch (e) {
      // A 409 means the root is gone; the page shows its own unavailable state.
      if (httpStatus(e) !== 409) toast.error(getErrorMessage(e, "Delete failed"));
      onError?.(e);
    } finally {
      setPending(false);
    }
  }

  function report(result: PruneDeleteResult) {
    if (result.deleted.length > 0) {
      toast.success(`Deleted ${describeSelection(result.deleted.length, "file")}`);
    }
    if (result.failed.length > 0) {
      const shown = result.failed
        .slice(0, 3)
        .map((f) => `${names.get(f.path) ?? f.path}: ${f.error}`)
        .join("\n");
      const more = result.failed.length - 3;
      toast.error(`${describeSelection(result.failed.length, "file")} could not be deleted`, {
        description: `${shown}${more > 0 ? `\nand ${more} more` : ""}\nThey are still selected.`,
      });
    }
    onResult(result);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        className="max-w-md animate-slide-up-fade"
        role="dialog"
        aria-label="Delete files"
      >
        <DialogHeader>
          <DialogTitle>Delete {what}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">
              {describeSelection(count, "file", bytes)}
            </span>{" "}
            will be removed from disk. This cannot be undone.
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-px-surface px-3 py-2">
            {files.slice(0, MAX_NAMES).map((f) => (
              <li key={f.path} className="truncate text-xs">
                {f.name}
              </li>
            ))}
          </ul>
          {count > MAX_NAMES && (
            <p className="text-xs text-muted-foreground">and {count - MAX_NAMES} more</p>
          )}
          {chunked && pending && (
            <p role="status" className="animate-fade-in text-xs text-muted-foreground">
              Deleting in batches:{" "}
              <span key={sent} className="inline-block animate-pop tabular-nums text-foreground">
                {sent.toLocaleString()}
              </span>{" "}
              of <span className="tabular-nums">{count.toLocaleString()}</span> done
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void run()}>
            {pending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-3.5 w-3.5" />
            )}
            Delete {what}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
