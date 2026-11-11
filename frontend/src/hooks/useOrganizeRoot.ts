import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { isConflict } from "@/lib/api/client";
import type { ScanState } from "@/types/organize";

/**
 * Organize's saved root folder and the scan of it: the root query, the polled scan
 * state, the start-scan and save-root mutations, and the "folder unavailable" flag
 * (any 409, or a call the page saw answered 409 via `markGone`).
 *
 * `onReset` is what the page does when the tree it was showing is replaced (a forced
 * rescan, a new root): it clears the selection, and staged edits too when the root itself
 * changed (a rescan keeps them: the review flags any file that went away). It only runs inside callbacks, so the
 * page may pass a function declared further down.
 */
export function useOrganizeRoot({
  onReset,
}: {
  /** `rootChanged` is false for a rescan and for re-picking the same folder. */
  onReset: (info: { rootChanged: boolean }) => void;
}) {
  const qc = useQueryClient();
  const routerNavigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pathParam = searchParams.get("path");
  const [picking, setPicking] = useState(false);
  // A call answered 409: the root is gone. Tagged with the root it was seen on.
  const [goneRoot, setGoneRoot] = useState<string | null>(null);

  const rootQ = useQuery({ queryKey: qk.organizeRoot(), queryFn: () => api.getOrganizeRoot() });
  const root = rootQ.data?.root ?? null;

  const scanQ = useQuery({
    queryKey: qk.organizeScan(),
    queryFn: () => api.getOrganizeScan(),
    enabled: !!root,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 500 : false),
  });

  // `force` = Rescan: always re-walk. Otherwise the backend reuses a finished scan
  // of the same root, so revisiting the page keeps listings and selection.
  const startScan = useMutation({
    mutationFn: (force: boolean) => api.startOrganizeScan(force),
    meta: { skipErrorToast: true },
    onMutate: (force) => {
      if (!force) return;
      // Cached listings describe the previous scan.
      qc.removeQueries({ queryKey: qk.organizeFolder() });
      qc.removeQueries({ queryKey: qk.organizeFiles() });
      onReset({ rootChanged: false });
    },
    onSuccess: (state: ScanState) => {
      qc.setQueryData(qk.organizeScan(), state);
      void qc.invalidateQueries({ queryKey: qk.organizeScan() });
    },
  });

  const saveRoot = useMutation({
    mutationFn: (path: string) => api.putOrganizeRoot(path),
    onSuccess: (res) => {
      const changed = res.root !== root;
      // Back at the (new) root; replace so Back never reopens a folder of the old tree.
      if (pathParam !== null) void routerNavigate({ search: "" }, { replace: true });
      onReset({ rootChanged: changed });
      setGoneRoot(null);
      qc.setQueryData(qk.organizeRoot(), res);
      // Re-picking the same folder is a rescan (the PUT also dropped the server cache).
      if (!changed) startScan.mutate(true);
    },
  });

  // Ensure a scan exists whenever a (new) root is known: on mount and after
  // Change folder. Non-forced, so a cached scan of this root is reused as is.
  const scannedRoot = useRef<string | null>(null);
  const { mutate: runScan } = startScan;
  useEffect(() => {
    if (root && scannedRoot.current !== root) {
      scannedRoot.current = root;
      runScan(false);
    }
  }, [root, runScan]);

  const scan = scanQ.data;
  const scanDone = scan?.status === "done";
  const unavailable =
    !!root &&
    (isConflict(scanQ.error) ||
      isConflict(startScan.error) ||
      isConflict(rootQ.error) ||
      goneRoot === root);

  return {
    rootQ,
    root,
    scan,
    scanDone,
    unavailable,
    startScan,
    saveRoot,
    picking,
    setPicking,
    markGone: () => {
      if (root) setGoneRoot(root);
    },
  };
}
