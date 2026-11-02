import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getErrorMessage, httpStatus } from "@/lib/api/client";
import { describeSelection, sumSizeOf } from "@/lib/format";
import { baseName } from "@/lib/path";
import { deleteInChunks } from "@/lib/pruneDelete";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  EmptyFolderCopy,
  FilesDeleteCopy,
  FolderDeleteCopy,
} from "@/components/prune/DeleteConfirmCopy";
import type { FolderNodeInfo, PruneDeleteResult, PruneFile } from "@/types/prune";

export interface PruneDeleteHandlers {
  /** What a file delete did (also after a partial run that then failed). */
  onFilesResult: (result: PruneDeleteResult) => void;
  /** A file delete failed for a reason other than the root vanishing (e.g. network). */
  onFilesError: (error: unknown) => void;
  /** An emptied folder the user chose to delete is gone. */
  onEmptyFolderDeleted: (path: string) => void;
  onFolderDeleted: (path: string) => void;
  /** A folder delete failed part-way; the backend may have removed some of it. */
  onFolderFailed: () => void;
  /** A 409 from any delete: the root folder is no longer available. */
  onGone: () => void;
}

type FolderToDelete = Pick<FolderNodeInfo, "name" | "path" | "total">;

/**
 * Prune's delete flows on the shared `useConfirm()` (the Cleanup pattern: confirm,
 * then the page runs the call). `deleteFiles` asks, then deletes in sequential
 * chunks of 500 (`deleteInChunks`, merged results; `progress` counts the paths sent
 * for the dock's "Deleting N / M…"), toasts what happened and asks once per folder
 * the delete left empty (`only_if_empty`). `deleteFolder` asks with an "I'm sure"
 * acknowledgement. `deleting` is true while any delete runs; a second delete is
 * ignored until it ends. The page reacts through `handlers` (read at call time).
 */
export function usePruneDelete(handlers: PruneDeleteHandlers) {
  const confirm = useConfirm();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const running = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

  const begin = () => {
    if (running.current) return false;
    running.current = true;
    setDeleting(true);
    return true;
  };
  const end = () => {
    running.current = false;
    setDeleting(false);
    setProgress(null);
  };

  const askEmptyFolders = useCallback(
    async (paths: string[]) => {
      for (const [i, path] of paths.entries()) {
        const ok = await confirm({
          title: paths.length > 1 ? `Empty folder (${i + 1} of ${paths.length})` : "Empty folder",
          description: <EmptyFolderCopy name={baseName(path)} />,
          confirmText: "Delete",
          cancelText: "Keep",
          destructive: true,
        });
        if (!ok) continue;
        try {
          // Only if still empty: something may have landed in it since the prompt opened.
          await api.pruneDeleteFolder(path, true);
          latest.current.onEmptyFolderDeleted(path);
        } catch (e) {
          const msg = getErrorMessage(e, "Could not delete the folder");
          if (httpStatus(e) === 409 && msg.includes("no longer empty")) {
            toast.info("Folder isn't empty any more — kept");
          } else {
            toast.error(msg);
          }
        }
      }
    },
    [confirm],
  );

  const deleteFiles = useCallback(
    async (files: PruneFile[]) => {
      if (files.length === 0 || running.current) return;
      const paths = files.map((f) => f.path);
      const what = describeSelection(files.length, "file");
      const ok = await confirm({
        title: `Delete ${what}?`,
        description: (
          <FilesDeleteCopy
            names={files.map((f) => f.name)}
            bytes={sumSizeOf(files, new Set(paths), (f) => f.path)}
          />
        ),
        confirmText: `Delete ${what}`,
        destructive: true,
      });
      if (!ok || !begin()) return;
      const names = new Map(files.map((f) => [f.path, f.name]));
      let emptied: string[] = [];
      setProgress({ sent: 0, total: paths.length });
      try {
        // Sequential chunks of 500; stops at the first failed chunk and still
        // reports what that run already deleted.
        const { result, error } = await deleteInChunks(
          paths,
          (chunk) => api.pruneDelete(chunk),
          (sent) => setProgress({ sent, total: paths.length }),
        );
        const anything = result.deleted.length + result.failed.length + result.empty_folders.length;
        if (error === null || anything > 0) {
          report(result, names);
          latest.current.onFilesResult(result);
          emptied = result.empty_folders;
        }
        if (error !== null) {
          if (httpStatus(error) === 409) {
            // The root is gone; the page shows its own unavailable state.
            latest.current.onGone();
            return;
          }
          toast.error(getErrorMessage(error, "Delete failed"));
          latest.current.onFilesError(error);
          return;
        }
      } finally {
        end();
      }
      if (emptied.length > 0) await askEmptyFolders(emptied);
    },
    [confirm, askEmptyFolders],
  );

  const deleteFolder = useCallback(
    async (folder: FolderToDelete) => {
      if (running.current) return;
      const { files, bytes } = folder.total;
      const ok = await confirm({
        title: "Delete this folder?",
        description: <FolderDeleteCopy name={folder.name} files={files} bytes={bytes} />,
        confirmText: "Delete folder",
        destructive: true,
        acknowledge: "I'm sure",
      });
      if (!ok || !begin()) return;
      const id = toast.loading(`Deleting ${folder.name}…`);
      try {
        await api.pruneDeleteFolder(folder.path);
        toast.success(`Deleted ${folder.name}`, {
          id,
          description: describeSelection(files, "file", bytes),
        });
        latest.current.onFolderDeleted(folder.path);
      } catch (e) {
        if (httpStatus(e) === 409) {
          toast.dismiss(id);
          latest.current.onGone();
          return;
        }
        toast.error(`Could not fully delete ${folder.name}`, {
          id,
          description: "Some of it may already be gone. Prune is rescanning to show what is left.",
        });
        latest.current.onFolderFailed();
      } finally {
        end();
      }
    },
    [confirm],
  );

  return { deleteFiles, deleteFolder, deleting, progress };
}

/** Toasts a file delete's outcome; failed paths stay selected for a retry. */
function report(result: PruneDeleteResult, names: Map<string, string>) {
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
}
