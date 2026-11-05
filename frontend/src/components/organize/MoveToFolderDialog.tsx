import { useState } from "react";
import { ChevronRight, Folder, FolderOutput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/api/client";
import { REDACTED_FOLDER } from "@/lib/organizeRedact";
import { cn } from "@/lib/utils";
import type { OrganizeFolder } from "@/types/organize";

/**
 * "Move to folder" popup: browse the scanned tree (breadcrumbs + subfolders, starting
 * where the files are) and pick the folder to move into. The page owns what is being
 * browsed (`folder`, from the scan's folder listing) and the call; `onSubmit` throws on
 * failure and the message shows here while the dialog stays open.
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  summary,
  currentPath,
  folder,
  loading,
  loadError,
  onBrowse,
  onSubmit,
  redact = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being moved, e.g. "12 files (4.8 MB)". */
  summary: string;
  /** The folder the files are in; it can't be the destination. */
  currentPath: string;
  /** The folder being browsed; undefined while it loads. */
  folder: OrganizeFolder | undefined;
  loading: boolean;
  loadError?: string;
  onBrowse: (path: string) => void;
  onSubmit: (destination: string) => Promise<void>;
  redact?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const label = (name: string) => (redact ? REDACTED_FOLDER : name);
  const same = folder?.path === currentPath;

  const close = () => {
    setSubmitError("");
    onOpenChange(false);
  };

  const submit = async () => {
    if (!folder || same) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmit(folder.path);
      close();
    } catch (e) {
      setSubmitError(getErrorMessage(e, "Could not move the files"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md" onClose={close}>
        <DialogHeader>
          <DialogTitle>Move to folder</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Move {summary} into any folder under the chosen folder. Nothing is overwritten.
          </p>
        </DialogHeader>
        <div className="space-y-2">
          <nav
            aria-label="Destination folder path"
            className="flex flex-wrap items-center gap-0.5 text-xs"
          >
            {folder?.breadcrumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <button
                  type="button"
                  onClick={() => onBrowse(c.path)}
                  className={cn(
                    "rounded px-1 py-0.5 hover:bg-accent",
                    c.path === folder.path && "font-medium text-foreground",
                    c.path !== folder.path && "text-muted-foreground",
                  )}
                >
                  {label(c.name)}
                </button>
              </span>
            ))}
          </nav>
          <div
            aria-label="Subfolders"
            className="h-64 overflow-y-auto rounded-md border bg-px-elevated"
          >
            {loadError ? (
              <p className="p-3 text-sm text-destructive">{loadError}</p>
            ) : !folder || loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : folder.subfolders.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No subfolders here.</p>
            ) : (
              <ul>
                {folder.subfolders.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => onBrowse(f.path)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-hidden"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-primary/80" />
                      <span className="min-w-0 flex-1 truncate">{label(f.name)}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {same && (
            <p className="text-xs text-muted-foreground">
              The files are already here. Open another folder to move them.
            </p>
          )}
          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!folder || same || submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOutput className="mr-2 h-3.5 w-3.5" />
            )}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
