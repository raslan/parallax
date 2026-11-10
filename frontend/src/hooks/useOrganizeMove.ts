import { useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qk } from "@/lib/api";
import { errorDetail, isConflict } from "@/lib/api/client";
import { describeSelection, sumSizeOf } from "@/lib/format";
import { REDACTED_FOLDER } from "@/lib/organizeRedact";
import { toastFailures } from "@/lib/organizeToast";
import { baseName } from "@/lib/path";
import type { MoveToFolderDialog } from "@/components/organize/MoveToFolderDialog";
import type { MoveToSubfolderDialog } from "@/components/organize/MoveToSubfolderDialog";
import type { OrganizeFile, OrganizeMoveResult } from "@/types/organize";

/**
 * Organize's two move flows (into a named subfolder of the open folder, or into any
 * scanned folder). Each dialog asks for its target, then `runMove` makes the call.
 * It throws (so the dialog stays open on the message) except for a vanished root:
 * a 409 closes the dialogs and reports through `onGone`.
 *
 * Files that moved are handed to `onFilesGone(paths, true)` (the page drops them from
 * the selection and plays the exit animation); failed ones stay selected and are toasted.
 */
export function useOrganizeMove(a: {
  currentPath: string | null;
  actionFiles: OrganizeFile[];
  selectedPaths: Set<string>;
  unavailable: boolean;
  redact: boolean;
  onFilesGone: (paths: string[], animate: boolean) => void;
  onGone: () => void;
}) {
  const { currentPath, actionFiles, selectedPaths, unavailable, redact } = a;
  const [subfolderOpen, setSubfolderOpen] = useState(false);
  // The folder dialog browses the scanned tree (its own folder listing, shared with the
  // page's cache) and hands back the chosen destination.
  const [folderOpen, setFolderOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const browseQ = useQuery({
    queryKey: qk.organizeFolder(browsePath),
    queryFn: () => api.getOrganizeFolder(browsePath),
    enabled: folderOpen && !!browsePath && !unavailable,
    retry: false,
  });

  const closeAll = () => {
    setSubfolderOpen(false);
    setFolderOpen(false);
  };

  const runMove = async (call: () => Promise<OrganizeMoveResult>, destination: string) => {
    if (!currentPath) return;
    let result: OrganizeMoveResult | undefined;
    let failure = "";
    try {
      result = await call();
    } catch (e) {
      if (isConflict(e)) {
        closeAll();
        a.onGone();
        return;
      }
      failure = errorDetail(e, "Could not move the files");
    }
    if (!result) throw new Error(failure);
    // Failed paths are not in `moved`, so they stay selected for a retry.
    if (result.moved.length > 0) {
      a.onFilesGone(result.moved, true);
      toast.success(
        `Moved ${describeSelection(result.moved.length, "file")} to ${redact ? REDACTED_FOLDER : destination}`,
      );
    }
    toastFailures(result.failed, "moved", redact);
  };

  const paths = () => actionFiles.map((f) => f.path);
  const summary = describeSelection(
    actionFiles.length,
    "file",
    sumSizeOf(actionFiles, selectedPaths, (f) => f.path),
  );

  const subfolderDialogProps: ComponentProps<typeof MoveToSubfolderDialog> = {
    open: subfolderOpen,
    onOpenChange: setSubfolderOpen,
    summary,
    onSubmit: (name) =>
      runMove(() => api.organizeMoveToSubfolder(currentPath ?? "", paths(), name), name),
  };

  const folderDialogProps: ComponentProps<typeof MoveToFolderDialog> = {
    open: folderOpen,
    onOpenChange: setFolderOpen,
    summary,
    currentPath: currentPath ?? "",
    folder: browseQ.data,
    loading: browseQ.isFetching && !browseQ.data,
    loadError: browseQ.isError
      ? errorDetail(browseQ.error, "Could not open the folder")
      : undefined,
    onBrowse: setBrowsePath,
    onSubmit: (destination) =>
      runMove(
        () => api.organizeMoveToFolder(currentPath ?? "", paths(), destination),
        baseName(destination),
      ),
    redact,
  };

  return {
    subfolderDialogProps,
    folderDialogProps,
    openSubfolderDialog: () => setSubfolderOpen(true),
    openFolderDialog: () => {
      setBrowsePath(currentPath ?? "");
      setFolderOpen(true);
    },
    closeAll,
  };
}
