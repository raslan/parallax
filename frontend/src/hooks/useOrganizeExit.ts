import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api";

/** How long the delete exit animation plays before the lists refetch. */
export const EXIT_MS = 220;

/**
 * The exit animation of Organize's file and folder lists: paths that are on their
 * way out ("leaving") keep rendering with the exit class until `refreshListings`
 * refetches the listings and empties both sets. A refresh still pending on unmount
 * is dropped.
 */
export function useOrganizeExit() {
  const qc = useQueryClient();
  const [leavingFiles, setLeavingFiles] = useState<ReadonlySet<string>>(new Set());
  const [leavingFolders, setLeavingFolders] = useState<ReadonlySet<string>>(new Set());
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(exitTimer.current), []);

  const leaveFiles = useCallback((paths: string[]) => setLeavingFiles(new Set(paths)), []);

  /** Replaces the leaving folders, or adds to them when `additive`. */
  const leaveFolders = useCallback(
    (paths: string[], additive = false) =>
      setLeavingFolders((prev) => new Set([...(additive ? prev : []), ...paths])),
    [],
  );

  /** Refetch listings (totals change all the way up the tree) once the exit animation ends. */
  const refreshListings = useCallback(
    (delay = 0) => {
      clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        setLeavingFiles(new Set());
        setLeavingFolders(new Set());
        void qc.invalidateQueries({ queryKey: qk.organizeFolder() });
        void qc.invalidateQueries({ queryKey: qk.organizeFiles() });
      }, delay);
    },
    [qc],
  );

  return { leavingFiles, leavingFolders, leaveFiles, leaveFolders, refreshListings };
}
