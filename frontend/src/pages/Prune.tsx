import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, FolderOpen, FolderSearch, FolderX } from "lucide-react";
import { api, qk } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import { formatSize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { PageSkeleton } from "@/components/Skeletons";
import { StatPanel } from "@/components/StatPanel";
import { PruneFolderPicker } from "@/components/prune/PruneFolderPicker";
import { PruneRootBar } from "@/components/prune/PruneRootBar";
import type { ScanState } from "@/types/prune";

/** The backend answers 409 for "no folder selected" / "folder is no longer available". */
const isConflict = (e: unknown) => getErrorMessage(e, "").startsWith("409");

export function Prune() {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  // null = the root itself; set when the user navigates into a subfolder.
  const [pathOverride, setPathOverride] = useState<string | null>(null);

  const rootQ = useQuery({ queryKey: qk.pruneRoot(), queryFn: () => api.getPruneRoot() });
  const root = rootQ.data?.root ?? null;
  const currentPath = pathOverride ?? root;

  const scanQ = useQuery({
    queryKey: qk.pruneScan(),
    queryFn: () => api.getPruneScan(),
    enabled: !!root,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 500 : false),
  });

  const startScan = useMutation({
    mutationFn: () => api.startPruneScan(),
    meta: { skipErrorToast: true },
    onMutate: () => {
      // Cached listings describe the previous scan.
      qc.removeQueries({ queryKey: ["prune", "folder"] });
      qc.removeQueries({ queryKey: ["prune", "files"] });
    },
    onSuccess: (state: ScanState) => {
      qc.setQueryData(qk.pruneScan(), state);
      void qc.invalidateQueries({ queryKey: qk.pruneScan() });
    },
  });

  const saveRoot = useMutation({
    mutationFn: (path: string) => api.putPruneRoot(path),
    onSuccess: (res) => {
      const changed = res.root !== root;
      setPathOverride(null);
      qc.setQueryData(qk.pruneRoot(), res);
      if (!changed) startScan.mutate();
    },
  });

  // Scan once whenever a (new) root is known: on mount and after Change folder.
  const scannedRoot = useRef<string | null>(null);
  const { mutate: runScan } = startScan;
  useEffect(() => {
    if (root && scannedRoot.current !== root) {
      scannedRoot.current = root;
      runScan();
    }
  }, [root, runScan]);

  const scan = scanQ.data;
  const scanDone = scan?.status === "done";
  const unavailable =
    !!root && (isConflict(scanQ.error) || isConflict(startScan.error) || isConflict(rootQ.error));

  const folderQ = useQuery({
    queryKey: qk.pruneFolder(currentPath ?? ""),
    queryFn: () => api.getPruneFolder(currentPath ?? ""),
    enabled: !!currentPath && scanDone && !unavailable,
    retry: false,
  });

  const picker = (
    <PruneFolderPicker open={picking} onOpenChange={setPicking} onSelect={saveRoot.mutate} />
  );

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Prune</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Walk a folder, see what is in it and clear out what you do not need.
      </p>
    </div>
  );

  if (rootQ.isPending) return <PageSkeleton />;

  if (rootQ.isError && !isConflict(rootQ.error)) {
    return (
      <div className="space-y-5 p-6">
        {header}
        <QueryError error={rootQ.error} onRetry={() => void rootQ.refetch()} />
      </div>
    );
  }

  if (!root) {
    return (
      <div className="space-y-5 p-6">
        {header}
        <EmptyState
          icon={Eraser}
          title="Choose a folder to prune"
          description="Pick any folder and Prune will map it, count what is inside and let you delete files or whole folders safely."
          action={
            <Button onClick={() => setPicking(true)}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Choose folder
            </Button>
          }
        />
        {picker}
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-5 p-6">
      {header}
      <PruneRootBar
        root={root}
        scan={scan}
        busy={saveRoot.isPending || startScan.isPending}
        onChangeFolder={() => setPicking(true)}
        onRescan={() => startScan.mutate()}
      />

      {unavailable ? (
        <EmptyState
          icon={FolderX}
          title="This folder is no longer available"
          description="It may have been moved, deleted or unmounted. Choose another folder to continue."
          action={
            <Button onClick={() => setPicking(true)}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Change folder
            </Button>
          }
        />
      ) : scan?.status === "error" ? (
        <QueryError
          title="The scan failed"
          error="Prune could not finish reading this folder."
          onRetry={() => startScan.mutate()}
        />
      ) : folderQ.isError ? (
        <QueryError error={folderQ.error} onRetry={() => void folderQ.refetch()} />
      ) : folderQ.data ? (
        <div className="animate-slide-up-fade space-y-4">
          <StatPanel
            stats={[
              { label: "Files", value: folderQ.data.total.files.toLocaleString(), accent: true },
              { label: "Size", value: formatSize(folderQ.data.total.bytes) },
              { label: "Folders", value: folderQ.data.subfolders.length.toLocaleString() },
            ]}
          />
        </div>
      ) : (
        <EmptyState
          icon={FolderSearch}
          title="Mapping your folder"
          description="Counting files and folders. This only takes a moment."
        />
      )}
      {picker}
    </div>
  );
}
