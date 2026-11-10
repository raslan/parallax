import { useMemo, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorDetail, isConflict } from "@/lib/api/client";
import { describeSelection } from "@/lib/format";
import { REDACTED_FOLDER } from "@/lib/organizeRedact";
import type { RenameItem } from "@/lib/organizeRename";
import { toastFailures } from "@/lib/organizeToast";
import type { RenameDialog } from "@/components/organize/RenameDialog";
import type { FolderNodeInfo, OrganizeFile, OrganizeRenameResult } from "@/types/organize";

/**
 * Organize's rename flows: the selected files (find/replace, or a typed name for one)
 * or one subfolder. `onSubmit` throws on failure so the dialog stays open on the
 * message, except for a vanished root (409): that closes the dialog and reports through
 * `onGone`.
 *
 * Renamed files are handed to `onFilesGone(paths, false)` (they leave the selection, the
 * listing refetches); a renamed folder to `onFolderRenamed(oldPath)` (the page drops its
 * cached listings and refetches).
 */
export function useOrganizeRename(a: {
  currentPath: string | null;
  actionFiles: OrganizeFile[];
  files: OrganizeFile[] | undefined;
  subfolders: FolderNodeInfo[] | undefined;
  redact: boolean;
  onFilesGone: (paths: string[], animate: boolean) => void;
  onFolderRenamed: (oldPath: string) => void;
  onGone: () => void;
}) {
  const { currentPath, actionFiles, files, subfolders, redact } = a;
  const [renamingFiles, setRenamingFiles] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<FolderNodeInfo | null>(null);
  const items: RenameItem[] = renamingFolder
    ? [{ path: renamingFolder.path, name: renamingFolder.name }]
    : actionFiles.map((f) => ({ path: f.path, name: f.name }));
  // Every name in the open folder, files and folders: a rename onto one is refused.
  const taken = useMemo(
    () => new Set([...(files ?? []).map((f) => f.name), ...(subfolders ?? []).map((f) => f.name)]),
    [files, subfolders],
  );

  const closeAll = () => {
    setRenamingFiles(false);
    setRenamingFolder(null);
  };

  const renameFiles = async (toRename: RenameItem[]) => {
    if (!currentPath) return;
    let result: OrganizeRenameResult | undefined;
    let failure = "";
    try {
      result = await api.organizeRename(currentPath, toRename);
    } catch (e) {
      if (isConflict(e)) {
        closeAll();
        a.onGone();
        return;
      }
      failure = errorDetail(e, "Could not rename the files");
    }
    if (!result) throw new Error(failure);
    // Renamed paths no longer exist; the rest stay selected for a retry.
    if (result.renamed.length > 0) {
      a.onFilesGone(
        result.renamed.map((r) => r.path),
        false,
      );
      toast.success(`Renamed ${describeSelection(result.renamed.length, "file")}`);
    }
    toastFailures(result.failed, "renamed", redact);
  };

  const renameFolder = async (toRename: RenameItem[]) => {
    const [item] = toRename;
    if (!item) return;
    let failure = "";
    try {
      await api.organizeRenameFolder(item.path, item.name);
    } catch (e) {
      if (isConflict(e)) {
        closeAll();
        a.onGone();
        return;
      }
      failure = errorDetail(e, "Could not rename the folder");
    }
    if (failure) throw new Error(failure);
    a.onFolderRenamed(item.path);
    toast.success(`Renamed folder to ${redact ? REDACTED_FOLDER : item.name}`);
  };

  const dialogProps: ComponentProps<typeof RenameDialog> = {
    open: renamingFiles || renamingFolder !== null,
    onOpenChange: (v) => {
      if (!v) closeAll();
    },
    noun: renamingFolder ? "folder" : "file",
    items,
    taken,
    onSubmit: renamingFolder ? renameFolder : renameFiles,
  };

  return {
    dialogProps,
    openFiles: () => setRenamingFiles(true),
    openFolder: (f: FolderNodeInfo) => setRenamingFolder(f),
    closeAll,
  };
}
