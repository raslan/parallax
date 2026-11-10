import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { isScanningConflict } from "@/lib/api/client";
import { folderSearch, resolveOpenFolder } from "@/lib/organizeNav";
import { useOrganizeDetails } from "@/hooks/useOrganizeDetails";
import type { OrganizeFile } from "@/types/organize";

/** How long, and how often, a folder request waits out a scan that is still running. */
const SCAN_RETRY_MS = 750;
const SCAN_RETRIES = 80;

/** Stable identity while the file list loads, so the details hook doesn't restart. */
const NO_FILES: OrganizeFile[] = [];

/**
 * The open folder and its listings. The open folder lives in the URL (`?path=`, none =
 * the root), so Back/Forward walk the folders visited. It is derived here every render;
 * a value outside the root (e.g. one left from a previous root) or malformed opens the
 * root flagged `badPath`.
 */
export function useOrganizeBrowse(
  root: string | null,
  gate: { scanDone: boolean; unavailable: boolean },
) {
  const qc = useQueryClient();
  const routerNavigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pathParam = searchParams.get("path");
  const open = root ? resolveOpenFolder(pathParam, root) : null;
  const currentPath = open?.path ?? root;
  const badPath = open ? !open.valid : false;
  const atRoot = currentPath === root;

  /** Link target that opens `path` (a pushed history entry). */
  const linkTo = (path: string) => ({ search: root ? folderSearch(path, root) : "" });

  /**
   * Programmatic moves (the open folder was deleted, the root changed) replace the
   * current entry: pushing would leave a dead folder for Back to return to.
   */
  const replaceFolder = (path: string) => {
    void routerNavigate(linkTo(path), { replace: true });
  };

  const folderQ = useQuery({
    queryKey: qk.organizeFolder(currentPath ?? ""),
    queryFn: async () => {
      try {
        return await api.getOrganizeFolder(currentPath ?? "");
      } catch (e) {
        // The page can hold a stale "scan done" (a rescan just began): refresh the scan
        // state so it shows the scanning panel, and let the retry below wait it out.
        if (isScanningConflict(e)) void qc.invalidateQueries({ queryKey: qk.organizeScan() });
        throw e;
      }
    },
    enabled: !!currentPath && gate.scanDone && !gate.unavailable,
    // "scanning" is a wait, not a failure: retry for up to a minute, any other error shows.
    retry: (count, e) => isScanningConflict(e) && count < SCAN_RETRIES,
    retryDelay: SCAN_RETRY_MS,
  });

  // Direct files only exist to list when the open folder has some.
  const hasFiles = (folderQ.data?.direct.files ?? 0) > 0;
  const filesQ = useQuery({
    queryKey: qk.organizeFiles(currentPath ?? ""),
    queryFn: () => api.getOrganizeFiles(currentPath ?? ""),
    enabled: !!currentPath && hasFiles && !gate.unavailable,
    retry: false,
  });
  const fileList = filesQ.data ?? NO_FILES;
  const detailsProgress = useOrganizeDetails(currentPath ?? "", fileList);

  return {
    currentPath,
    badPath,
    atRoot,
    folderQ,
    filesQ,
    hasFiles,
    fileList,
    detailsProgress,
    linkTo,
    replaceFolder,
  };
}
