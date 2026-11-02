import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { httpStatus } from "@/lib/api/client";
import { describeSelection } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Counts } from "@/types/prune";

export interface FolderToDelete {
  name: string;
  path: string;
  total: Counts;
}

function Body({
  folder,
  onClose,
  onDeleted,
  onFailed,
  onGone,
}: {
  folder: FolderToDelete;
  onClose: () => void;
  onDeleted: (path: string) => void;
  onFailed?: (error: unknown) => void;
  onGone?: () => void;
}) {
  const [sure, setSure] = useState(false);
  const [pending, setPending] = useState(false);
  const { files, bytes } = folder.total;

  async function run() {
    setPending(true);
    try {
      await api.pruneDeleteFolder(folder.path);
      toast.success(`Deleted ${folder.name}`, {
        description: describeSelection(files, "file", bytes),
      });
      onDeleted(folder.path);
    } catch (e) {
      if (httpStatus(e) === 409 && onGone) {
        onGone();
        return;
      }
      toast.error(`Could not fully delete ${folder.name}`, {
        description: "Some of it may already be gone. Prune is rescanning to show what is left.",
      });
      onFailed?.(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        className="max-w-md animate-slide-up-fade"
        role="dialog"
        aria-label={`Delete ${folder.name}`}
      >
        <DialogHeader>
          <DialogTitle>Delete this folder?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="break-words font-medium">{folder.name}</p>
          <p className="text-muted-foreground">
            This removes{" "}
            <span className="font-mono tabular-nums text-foreground">
              {describeSelection(files, "file", bytes)}
            </span>{" "}
            and everything inside it. Hidden entries and symlinks in the folder are removed too,
            even though Prune does not list them. This cannot be undone.
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-px-surface px-3 py-2.5 transition-colors duration-100 hover:border-primary/40">
            <Checkbox
              checked={sure}
              onCheckedChange={(v) => setSure(v === true)}
              aria-label="I'm sure"
              disabled={pending}
            />
            <span>I&apos;m sure</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!sure || pending} onClick={() => void run()}>
            {pending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-3.5 w-3.5" />
            )}
            Delete folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmation for deleting a whole folder. Renders nothing while `folder` is
 * null; the body mounts fresh each time it opens, so the "I'm sure" checkbox
 * always starts unticked. The caller closes it (`onClose`), reacts to success
 * (`onDeleted`) and to failure (`onFailed` — the backend may have removed part
 * of the tree, so rescan). `onGone` fires instead of the generic toast on a 409.
 */
export function DeleteFolderDialog({
  folder,
  ...rest
}: {
  folder: FolderToDelete | null;
  onClose: () => void;
  onDeleted: (path: string) => void;
  onFailed?: (error: unknown) => void;
  onGone?: () => void;
}) {
  if (!folder) return null;
  return <Body key={folder.path} folder={folder} {...rest} />;
}
