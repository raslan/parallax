import { FolderInput, FolderOutput, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectionBar } from "@/components/SelectionBar";
import { DELETE_CHUNK } from "@/lib/organizeDelete";

/** The action dock shown while files are selected: move, rename and delete. */
export function OrganizeSelectionDock({
  count,
  bytes,
  deleting,
  progress,
  onClear,
  onMoveToFolder,
  onMoveToSubfolder,
  onRename,
  onDelete,
}: {
  count: number;
  bytes: number;
  deleting: boolean;
  /** How many paths a running delete has sent so far, of how many in total. */
  progress: { sent: number; total: number } | null;
  onClear: () => void;
  onMoveToFolder: () => void;
  onMoveToSubfolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <SelectionBar count={count} bytes={bytes} onClear={onClear}>
      <Button variant="outline" size="sm" disabled={deleting} onClick={onMoveToFolder}>
        <FolderOutput className="mr-2 h-3.5 w-3.5" />
        Move to folder
      </Button>
      <Button variant="outline" size="sm" disabled={deleting} onClick={onMoveToSubfolder}>
        <FolderInput className="mr-2 h-3.5 w-3.5" />
        Move to subfolder
      </Button>
      <Button variant="outline" size="sm" disabled={deleting} onClick={onRename}>
        <Pencil className="mr-2 h-3.5 w-3.5" />
        Rename
      </Button>
      <Button variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
        {deleting ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            {progress && progress.total > DELETE_CHUNK ? (
              // Big selections go in batches of 500: show how far it has got.
              <span className="tabular-nums">
                Deleting{" "}
                <span key={progress.sent} className="inline-block animate-pop">
                  {progress.sent.toLocaleString()}
                </span>{" "}
                / {progress.total.toLocaleString()}…
              </span>
            ) : (
              "Deleting…"
            )}
          </>
        ) : (
          <>
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </>
        )}
      </Button>
    </SelectionBar>
  );
}
