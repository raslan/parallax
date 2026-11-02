import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerLeftUp, Eraser, FolderOpen, FolderX, Loader2, Trash2 } from "lucide-react";
import { api, qk } from "@/lib/api";
import { httpStatus } from "@/lib/api/client";
import { formatSize, sumSizeOf } from "@/lib/format";
import { folderAfterDelete, folderSearch, resolveOpenFolder } from "@/lib/pruneNav";
import {
  invertSelection,
  reconcileSelection,
  removeDeleted,
  sameSet,
  selectedIn,
} from "@/lib/pruneSelect";
import { DELETE_CHUNK } from "@/lib/pruneDelete";
import { pruneFields } from "@/lib/pruneSearch";
import { viewSignature } from "@/lib/pruneScroll";
import {
  fileSortDefaultDir,
  folderSortDefaultDir,
  sortFiles,
  type FileSortKey,
  type FolderSortKey,
} from "@/lib/pruneSort";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { QueryBuilder } from "@/components/QueryBuilder";
import { QueryError } from "@/components/QueryError";
import { SelectionBar } from "@/components/SelectionBar";
import { PageSkeleton } from "@/components/Skeletons";
import { SmartSelect, type SmartSelectOption } from "@/components/SmartSelect";
import { StatPanel } from "@/components/StatPanel";
import { WorkingState } from "@/components/WorkingState";
import { FolderBrowser } from "@/components/prune/FolderBrowser";
import { NameGroupChips } from "@/components/prune/NameGroupChips";
import { PruneFolderPicker } from "@/components/prune/PruneFolderPicker";
import { PruneRootBar } from "@/components/prune/PruneRootBar";
import { FileBrowser } from "@/components/prune/FileBrowser";
import { Tip } from "@/components/Tip";
import { BrowseControls } from "@/components/prune/BrowseControls";
import type { ViewMode } from "@/components/DataToolbar";
import { useGridSize } from "@/hooks/useGridSize";
import { useScrollParent } from "@/hooks/useScrollParent";
import { usePruneDelete } from "@/hooks/usePruneDelete";
import { usePruneDetails } from "@/hooks/usePruneDetails";
import { useQueryBuilder } from "@/hooks/useQueryBuilder";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import type { PruneDeleteResult, PruneFile, ScanState } from "@/types/prune";

/** Stable identity while the file list loads, so the details hook doesn't restart. */
const NO_FILES: PruneFile[] = [];

/** Filter fields that need ffprobe details, which stream in after the list. */
const ENRICHED = new Set(["duration", "resolution", "orientation", "codec", "bitrate"]);

/** How long the delete exit animation plays before the lists refetch. */
const EXIT_MS = 220;

/** The backend answers 409 for "no folder selected" / "folder is no longer available". */
const isConflict = (e: unknown) => httpStatus(e) === 409;

const isMissing = (e: unknown) => httpStatus(e) === 404;

export function Prune() {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const routerNavigate = useNavigate();
  // The open folder lives in the URL (`?path=`, none = the root), so Back/Forward walk
  // the folders visited. Derived here every render; a value outside the root (e.g. one
  // left from a previous root) or malformed opens the root flagged `badPath`.
  const [searchParams] = useSearchParams();
  const pathParam = searchParams.get("path");

  const rootQ = useQuery({ queryKey: qk.pruneRoot(), queryFn: () => api.getPruneRoot() });
  const root = rootQ.data?.root ?? null;
  const open = root ? resolveOpenFolder(pathParam, root) : null;
  const currentPath = open?.path ?? root;
  const badPath = open ? !open.valid : false;
  const atRoot = currentPath === root;
  const { selected, setSelected, toggle, selectAll, selectNone, setOrder, marqueeProps } =
    useSelection<string>();
  // A new folder (link, breadcrumb, Back/Forward, a delete moving up) starts with
  // nothing selected: adjusted during render, no effect.
  const [shownPath, setShownPath] = useState(currentPath);
  if (shownPath !== currentPath) {
    setShownPath(currentPath);
    selectNone();
  }
  // One view mode + card size for folders and files; both grids virtualise against
  // the page's own scroll (the layout's main area) so there is a single scroller.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [cardSize, setCardSize] = useGridSize(240);
  const [scroller, pageRef] = useScrollParent();
  const { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate } =
    useQueryBuilder(pruneFields);
  // One sort each for the folders and the files (Name ascending, counts/sizes descending).
  const folderSort = useSort<FolderSortKey>("files", folderSortDefaultDir);
  const fileSort = useSort<FileSortKey>("name", fileSortDefaultDir);
  // Shared-scroll grids can't reset themselves, so opening another folder or a changed
  // filter or sort (a different result set or order) scrolls back to the top.
  // Refetches and streaming details never change the signature, so they never jump
  // the page.
  const viewSig = `${currentPath}|${viewSignature(clauses, [
    { key: folderSort.sortKey, dir: folderSort.sortDir },
    { key: fileSort.sortKey, dir: fileSort.sortDir },
  ])}`;
  const lastViewSig = useRef(viewSig);
  useEffect(() => {
    if (lastViewSig.current === viewSig) return;
    lastViewSig.current = viewSig;
    scroller?.scrollTo({ top: 0 });
  }, [viewSig, scroller]);
  const [leavingFiles, setLeavingFiles] = useState<ReadonlySet<string>>(new Set());
  const [leavingFolders, setLeavingFolders] = useState<ReadonlySet<string>>(new Set());
  // A delete call answered 409: the root is gone. Tagged with the root it was seen on.
  const [goneRoot, setGoneRoot] = useState<string | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(exitTimer.current), []);

  /** Link target that opens `path` (a pushed history entry). */
  const linkTo = (path: string) => ({ search: root ? folderSearch(path, root) : "" });

  /**
   * Programmatic moves (the open folder was deleted, the root changed) replace the
   * current entry: pushing would leave a dead folder for Back to return to.
   */
  const replaceFolder = (path: string) => {
    void routerNavigate(linkTo(path), { replace: true });
  };

  /** Refetch listings (totals change all the way up the tree) once the exit animation ends. */
  const refreshListings = (delay = 0) => {
    clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setLeavingFiles(new Set());
      setLeavingFolders(new Set());
      void qc.invalidateQueries({ queryKey: qk.pruneFolder() });
      void qc.invalidateQueries({ queryKey: qk.pruneFiles() });
    }, delay);
  };

  const scanQ = useQuery({
    queryKey: qk.pruneScan(),
    queryFn: () => api.getPruneScan(),
    enabled: !!root,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 500 : false),
  });

  // `force` = Rescan: always re-walk. Otherwise the backend reuses a finished scan
  // of the same root, so revisiting the page keeps listings and selection.
  const startScan = useMutation({
    mutationFn: (force: boolean) => api.startPruneScan(force),
    meta: { skipErrorToast: true },
    onMutate: (force) => {
      if (!force) return;
      // Cached listings describe the previous scan.
      qc.removeQueries({ queryKey: qk.pruneFolder() });
      qc.removeQueries({ queryKey: qk.pruneFiles() });
      selectNone();
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
      // Back at the (new) root; replace so Back never reopens a folder of the old tree.
      if (pathParam !== null) void routerNavigate({ search: "" }, { replace: true });
      selectNone();
      setGoneRoot(null);
      qc.setQueryData(qk.pruneRoot(), res);
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

  const folderQ = useQuery({
    queryKey: qk.pruneFolder(currentPath ?? ""),
    queryFn: () => api.getPruneFolder(currentPath ?? ""),
    enabled: !!currentPath && scanDone && !unavailable,
    retry: false,
  });

  // Direct files only exist to list when the open folder has some.
  const hasFiles = (folderQ.data?.direct.files ?? 0) > 0;
  const filesQ = useQuery({
    queryKey: qk.pruneFiles(currentPath ?? ""),
    queryFn: () => api.getPruneFiles(currentPath ?? ""),
    enabled: !!currentPath && hasFiles && !unavailable,
    retry: false,
  });
  const fileList = filesQ.data ?? NO_FILES;
  const detailsProgress = usePruneDetails(currentPath ?? "", fileList);

  // Filter pass: rows carry their streamed details so enriched fields can test them.
  const { details } = detailsProgress;
  const visibleFiles = useMemo(() => {
    if (clauses.length === 0) return fileList;
    return fileList.filter((f) => evaluate({ ...f, details: details[f.path] }));
  }, [clauses.length, fileList, details, evaluate]);
  // Sorting never changes membership; shift-range selection follows this order.
  const sortedFiles = useMemo(
    () => sortFiles(visibleFiles, details, fileSort.sortKey, fileSort.sortDir),
    [visibleFiles, details, fileSort.sortKey, fileSort.sortDir],
  );
  const visiblePaths = useMemo(() => sortedFiles.map((f) => f.path), [sortedFiles]);
  useSelectionOrder(setOrder, visiblePaths);

  // Computed once per list of files (NameGroupChips defers and memoises on this identity).
  const fileNames = useMemo(() => fileList.map((f) => f.name), [fileList]);

  const enrichedActive = clauses.some((c) => ENRICHED.has(c.fieldKey));
  const stillLoading = enrichedActive
    ? Math.max(0, detailsProgress.total - detailsProgress.loaded)
    : 0;

  // Invariant: selection is a subset of the visible (filtered) results. Derived at
  // render (`actionFiles`), and the stored set is shrunk to match in the same pass
  // (adjusting state during render, no effect) so un-filtering never resurrects
  // selections that a filter hid. Also covers files that vanished from the list.
  // Strict: a file hidden only because its details haven't loaded is dropped too.
  // A refetch (e.g. after a partly failed delete) doesn't hide anything, because
  // usePruneDetails keeps unchanged files' details across list identities.
  const actionFiles = useMemo(() => selectedIn(visibleFiles, selected), [visibleFiles, selected]);
  const selectedPaths = useMemo(() => new Set(actionFiles.map((f) => f.path)), [actionFiles]);
  const shrunk = reconcileSelection(selected, selectedPaths);
  if (shrunk) setSelected(shrunk);

  const smartOptions = useMemo<SmartSelectOption[]>(() => {
    const make = (
      id: string,
      label: string,
      hint: string,
      list: PruneFile[],
    ): SmartSelectOption => {
      const paths = list.map((f) => f.path);
      return {
        id,
        label,
        hint,
        count: list.length,
        bytes: list.reduce((n, f) => n + f.size, 0),
        active: list.length > 0 && sameSet(selectedPaths, new Set(paths)),
        onSelect: () => selectAll(paths),
      };
    };
    const kind = (k: PruneFile["kind"]) => visibleFiles.filter((f) => f.kind === k);
    return [
      make(
        "matching",
        clauses.length > 0 ? "matching the filters" : "in this folder",
        "Select every file currently shown",
        visibleFiles,
      ),
      make("video", "videos", "Select the videos currently shown", kind("video")),
      make("image", "images", "Select the images currently shown", kind("image")),
      make("audio", "audio", "Select the audio files currently shown", kind("audio")),
      make("other", "other files", "Select the non-media files currently shown", kind("other")),
    ];
  }, [visibleFiles, clauses.length, selectedPaths, selectAll]);

  const pickName = useCallback(
    (text: string) => {
      const dup = clauses.some(
        (c) =>
          c.fieldKey === "name" &&
          c.operator === "contains" &&
          (c.value as { text?: string } | null)?.text === text,
      );
      if (dup) return;
      const id = addClause("name");
      if (id) updateClause(id, { value: { text } });
    },
    [clauses, addClause, updateClause],
  );

  // Delete flows (shared confirm, chunked calls, empty-folder prompts) live in the
  // hook; the page reacts to what happened.
  const { deleteFiles, deleteFolder, deleting, progress } = usePruneDelete({
    onFilesResult: (result: PruneDeleteResult) => {
      if (result.deleted.length === 0) return;
      // Failed paths are not in `deleted`, so they stay selected for a retry.
      setSelected((prev) => removeDeleted(prev, result.deleted));
      setLeavingFiles(new Set(result.deleted));
      refreshListings(EXIT_MS);
    },
    // Network/timeout: some files may already be gone.
    // Same delay as a result, so a partial run's exit animation still plays.
    onFilesError: () => refreshListings(EXIT_MS),
    onEmptyFolderDeleted: (path) => {
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) replaceFolder(up);
      setLeavingFolders((prev) => new Set(prev).add(path));
      refreshListings(EXIT_MS);
    },
    onFolderDeleted: (path) => {
      // Parent of the deleted folder, even when it is an ancestor of the open one.
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) {
        replaceFolder(up);
        // Drop the deleted folder's cached listings so Back to an older history
        // entry never flashes them before the gone state.
        qc.removeQueries({ queryKey: qk.pruneFolder(path) });
        qc.removeQueries({ queryKey: qk.pruneFiles(path) });
        refreshListings();
      } else {
        setLeavingFolders(new Set([path]));
        refreshListings(EXIT_MS);
      }
    },
    // The backend may have removed part of the tree and dropped its scan cache.
    onFolderFailed: () => startScan.mutate(true),
    onGone: () => {
      if (root) setGoneRoot(root);
    },
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
      <div className="space-y-6 p-4 md:p-8">
        {header}
        <QueryError error={rootQ.error} onRetry={() => void rootQ.refetch()} />
      </div>
    );
  }

  if (!root) {
    return (
      <div className="space-y-6 p-4 md:p-8">
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
    <div ref={pageRef} className="animate-fade-in space-y-6 p-4 md:p-8">
      {header}
      <PruneRootBar
        root={root}
        scan={scan}
        busy={saveRoot.isPending || startScan.isPending}
        onChangeFolder={() => setPicking(true)}
        onRescan={() => startScan.mutate(true)}
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
          onRetry={() => startScan.mutate(true)}
        />
      ) : badPath ||
        (folderQ.isError && !atRoot && (isMissing(folderQ.error) || isConflict(folderQ.error))) ? (
        <EmptyState
          icon={FolderX}
          title="This folder is gone"
          description="It was moved or deleted since the last scan, or the link points outside the chosen folder. Head back up, or rescan to refresh the tree."
          action={
            // Replaces the dead entry, so Back never lands on the gone folder again.
            <Button asChild>
              <Link to={{ search: "" }} replace>
                <CornerLeftUp className="mr-1.5 h-3.5 w-3.5" />
                Back to the top folder
              </Link>
            </Button>
          }
        />
      ) : folderQ.isError ? (
        <QueryError error={folderQ.error} onRetry={() => void folderQ.refetch()} />
      ) : scanDone ? (
        <div className="animate-slide-up-fade space-y-4">
          <StatPanel
            stats={[
              {
                label: "Files",
                value: folderQ.data?.total.files.toLocaleString() ?? "—",
                accent: true,
              },
              { label: "Size", value: folderQ.data ? formatSize(folderQ.data.total.bytes) : "—" },
              { label: "Folders", value: folderQ.data?.subfolders.length.toLocaleString() ?? "—" },
            ]}
          />
          <BrowseControls
            viewMode={viewMode}
            onViewMode={setViewMode}
            size={cardSize}
            onSize={setCardSize}
          />
          <FolderBrowser
            folder={folderQ.data}
            viewMode={viewMode}
            cardSize={cardSize}
            scrollElement={scroller}
            sortKey={folderSort.sortKey}
            sortDir={folderSort.sortDir}
            onSort={folderSort.toggleSort}
            linkTo={linkTo}
            onDelete={(f) => void deleteFolder(f)}
            onDeleteOpen={
              !atRoot && folderQ.data
                ? () =>
                    void deleteFolder({
                      name: folderQ.data.name,
                      path: folderQ.data.path,
                      total: folderQ.data.total,
                    })
                : undefined
            }
            leaving={leavingFolders}
          />
          {hasFiles &&
            (filesQ.isError ? (
              <QueryError error={filesQ.error} onRetry={() => void filesQ.refetch()} />
            ) : (
              <>
                {filesQ.data && (
                  <div className="space-y-3 rounded-lg border bg-card p-4">
                    <QueryBuilder
                      registry={pruneFields}
                      clauses={clauses}
                      fieldsByKey={fieldsByKey}
                      onAdd={addClause}
                      onRemove={removeClause}
                      onUpdate={updateClause}
                    />
                    {stillLoading > 0 && (
                      <p
                        role="status"
                        className="flex animate-fade-in items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="tabular-nums">{stillLoading.toLocaleString()}</span> still
                        loading, matches may grow as file details arrive
                      </p>
                    )}
                    <NameGroupChips names={fileNames} onPick={pickName} />
                    <div className="flex flex-wrap items-stretch gap-2">
                      <SmartSelect options={smartOptions} />
                      <div className="flex items-center gap-1">
                        <Tip label="Select the shown files that are not selected, and deselect the rest">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={visiblePaths.length === 0}
                            onClick={() => selectAll(invertSelection(visiblePaths, selected))}
                          >
                            Invert
                          </Button>
                        </Tip>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={selected.size === 0}
                          onClick={selectNone}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <FileBrowser
                  files={filesQ.data ? sortedFiles : undefined}
                  sortKey={fileSort.sortKey}
                  sortDir={fileSort.sortDir}
                  onSort={fileSort.toggleSort}
                  details={detailsProgress.details}
                  progress={detailsProgress}
                  selected={selected}
                  leaving={leavingFiles}
                  onToggleSelect={(f) => toggle(f.path)}
                  filtered={clauses.length > 0}
                  viewMode={viewMode}
                  cardSize={cardSize}
                  scrollElement={scroller}
                  marquee={marqueeProps}
                />
              </>
            ))}
        </div>
      ) : (
        <WorkingState
          title="Mapping your folder"
          message="Counting files and folders. This only takes a moment."
          progress={null}
        />
      )}
      <SelectionBar
        count={actionFiles.length}
        bytes={sumSizeOf(actionFiles, selectedPaths, (f) => f.path)}
        onClear={selectNone}
      >
        <Button
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={() => void deleteFiles(actionFiles)}
        >
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
      {picker}
    </div>
  );
}
