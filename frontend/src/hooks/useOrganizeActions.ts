import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api";
import { folderAfterDelete } from "@/lib/organizeNav";
import { removeDeleted } from "@/lib/organizeSelect";
import { useOrganizeDelete } from "@/hooks/useOrganizeDelete";
import { EXIT_MS, type useOrganizeExit } from "@/hooks/useOrganizeExit";
import { useOrganizeMove } from "@/hooks/useOrganizeMove";
import { useOrganizeRename } from "@/hooks/useOrganizeRename";
import type { useOrganizeSelection } from "@/hooks/useOrganizeSelection";
import type { FolderNodeInfo, OrganizeDeleteResult, OrganizeFile } from "@/types/organize";

/**
 * Everything the user can do to files and folders on Organize (delete, move, rename),
 * wired to the page's selection, exit animation and listings. Each flow lives in its
 * own hook; this composes them and reacts to what happened: moved, renamed and deleted
 * paths leave the selection, listings refetch (after the exit animation when files or
 * folders are leaving), and a vanished root (409) closes every dialog and reports
 * through `markGone`.
 */
export function useOrganizeActions(a: {
  currentPath: string | null;
  redact: boolean;
  unavailable: boolean;
  actionFiles: OrganizeFile[];
  selectedPaths: Set<string>;
  setSelected: ReturnType<typeof useOrganizeSelection>["setSelected"];
  files: OrganizeFile[] | undefined;
  subfolders: FolderNodeInfo[] | undefined;
  exit: Pick<ReturnType<typeof useOrganizeExit>, "leaveFiles" | "leaveFolders" | "refreshListings">;
  replaceFolder: (path: string) => void;
  /** A forced rescan: the backend may have removed part of the tree. */
  rescan: () => void;
  markGone: () => void;
  /** Files were moved, renamed or deleted: their staged tag edits are void. */
  onPathsGone: (paths: string[]) => void;
}) {
  const qc = useQueryClient();
  const { currentPath, redact, setSelected } = a;
  const { leaveFiles, leaveFolders, refreshListings } = a.exit;

  // A file leaves the open folder (moved, renamed): drop it from the selection and
  // refetch, with the exit animation when it is leaving rather than changing name.
  const onFilesGone = (paths: string[], animate: boolean) => {
    setSelected((prev) => removeDeleted(prev, paths));
    a.onPathsGone(paths);
    if (animate) {
      leaveFiles(paths);
      refreshListings(EXIT_MS);
    } else {
      refreshListings();
    }
  };

  // A vanished root (409) from any file action closes the dialogs and shows the
  // unavailable state; any other failure throws so the dialog stays open on the message.
  const dialogsOff = () => {
    move.closeAll();
    rename.closeAll();
    a.markGone();
  };

  // Delete flows (shared confirm, chunked calls, empty-folder prompts) live in the
  // hook; this reacts to what happened.
  const del = useOrganizeDelete({
    redact,
    onFilesResult: (result: OrganizeDeleteResult) => {
      if (result.deleted.length === 0) return;
      // Failed paths are not in `deleted`, so they stay selected for a retry.
      setSelected((prev) => removeDeleted(prev, result.deleted));
      a.onPathsGone(result.deleted);
      leaveFiles(result.deleted);
      refreshListings(EXIT_MS);
    },
    // Network/timeout: some files may already be gone.
    // Same delay as a result, so a partial run's exit animation still plays.
    onFilesError: () => refreshListings(EXIT_MS),
    onEmptyFolderDeleted: (path) => {
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) a.replaceFolder(up);
      leaveFolders([path], true);
      refreshListings(EXIT_MS);
    },
    onFolderDeleted: (path) => {
      // Parent of the deleted folder, even when it is an ancestor of the open one.
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) {
        a.replaceFolder(up);
        // Drop the deleted folder's cached listings so Back to an older history
        // entry never flashes them before the gone state.
        qc.removeQueries({ queryKey: qk.organizeFolder(path) });
        qc.removeQueries({ queryKey: qk.organizeFiles(path) });
        refreshListings();
      } else {
        leaveFolders([path]);
        refreshListings(EXIT_MS);
      }
    },
    // The backend may have removed part of the tree and dropped its scan cache.
    onFolderFailed: a.rescan,
    onGone: a.markGone,
  });

  const move = useOrganizeMove({
    currentPath,
    actionFiles: a.actionFiles,
    selectedPaths: a.selectedPaths,
    unavailable: a.unavailable,
    redact,
    onFilesGone,
    onGone: () => dialogsOff(),
  });

  const rename = useOrganizeRename({
    currentPath,
    actionFiles: a.actionFiles,
    files: a.files,
    subfolders: a.subfolders,
    redact,
    onFilesGone,
    onFolderRenamed: (oldPath) => {
      // The old path is dead: drop its cached listings, then reload the open folder.
      qc.removeQueries({ queryKey: qk.organizeFolder(oldPath) });
      qc.removeQueries({ queryKey: qk.organizeFiles(oldPath) });
      refreshListings();
    },
    onGone: () => dialogsOff(),
  });

  return {
    move,
    rename,
    deleteFiles: del.deleteFiles,
    deleteFolder: del.deleteFolder,
    deleting: del.deleting,
    progress: del.progress,
  };
}
