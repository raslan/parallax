import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CornerLeftUp,
  FolderTree,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderX,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { qk } from "@/lib/api";
import { isConflict, isMissing } from "@/lib/api/client";
import { formatSize, sumSizeOf } from "@/lib/format";
import { folderAfterDelete } from "@/lib/organizeNav";
import { invertSelection, removeDeleted } from "@/lib/organizeSelect";
import { DELETE_CHUNK } from "@/lib/organizeDelete";
import { organizeFields } from "@/lib/organizeSearch";
import { clauseSignature } from "@/lib/organizeScroll";
import {
  FILE_SORT_OPTIONS,
  FOLDER_SORT_OPTIONS,
  fileSortDefaultDir,
  folderSortDefaultDir,
  type FileSortKey,
  type FolderSortKey,
} from "@/lib/organizeSort";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { QueryBuilder } from "@/components/QueryBuilder";
import { QueryError } from "@/components/QueryError";
import { SelectionBar } from "@/components/SelectionBar";
import { PageSkeleton } from "@/components/Skeletons";
import { SmartSelect } from "@/components/SmartSelect";
import { StatPanel } from "@/components/StatPanel";
import { WorkingState } from "@/components/WorkingState";
import { FolderBrowser } from "@/components/organize/FolderBrowser";
import { NameGroupChips } from "@/components/organize/NameGroupChips";
import { OrganizeFolderPicker } from "@/components/organize/OrganizeFolderPicker";
import { OrganizeRootBar } from "@/components/organize/OrganizeRootBar";
import { FileBrowser } from "@/components/organize/FileBrowser";
import { MoveToSubfolderDialog } from "@/components/organize/MoveToSubfolderDialog";
import { MoveToFolderDialog } from "@/components/organize/MoveToFolderDialog";
import { RenameDialog } from "@/components/organize/RenameDialog";
import { Tip } from "@/components/Tip";
import { BrowseControls } from "@/components/organize/BrowseControls";
import type { ViewMode } from "@/components/DataToolbar";
import { useGridSize } from "@/hooks/useGridSize";
import { useScrollParent } from "@/hooks/useScrollParent";
import { useOrganizeDelete } from "@/hooks/useOrganizeDelete";
import { useOrganizeBrowse } from "@/hooks/useOrganizeBrowse";
import { useOrganizeMove } from "@/hooks/useOrganizeMove";
import { useOrganizeRename } from "@/hooks/useOrganizeRename";
import { EXIT_MS, useOrganizeExit } from "@/hooks/useOrganizeExit";
import { useOrganizeRoot } from "@/hooks/useOrganizeRoot";
import { useOrganizeFilters } from "@/hooks/useOrganizeFilters";
import { useOrganizeSelection } from "@/hooks/useOrganizeSelection";
import { useSort } from "@/hooks/useSort";
import type { OrganizeDeleteResult } from "@/types/organize";
import { PageTitle } from "@/components/PageTitle";

export function Organize() {
  const qc = useQueryClient();
  const {
    rootQ,
    root,
    scan,
    scanDone,
    unavailable,
    startScan,
    saveRoot,
    picking,
    setPicking,
    markGone,
  } = useOrganizeRoot({ onReset: () => selectNone() });
  const {
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
  } = useOrganizeBrowse(root, { scanDone, unavailable });
  // One view mode + card size for folders and files; both grids virtualise against
  // the page's own scroll (the layout's main area) so there is a single scroller.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [cardSize, setCardSize] = useGridSize(240);
  const [scroller, pageRef] = useScrollParent();
  // Demo mode: every folder/file name reads "Redacted …" and thumbnails stay hidden.
  const [redact, setRedact] = useState(false);
  // One sort each for the folders and the files (Name ascending, counts/sizes descending).
  const folderSort = useSort<FolderSortKey>("files", folderSortDefaultDir);
  const fileSort = useSort<FileSortKey>("name", fileSortDefaultDir);
  const {
    clauses,
    fieldsByKey,
    addClause,
    removeClause,
    updateClause,
    visibleFiles,
    sortedFiles,
    visiblePaths,
    fileNames,
    stillLoading,
    pickName,
  } = useOrganizeFilters(fileList, detailsProgress, fileSort);
  const {
    selected,
    setSelected,
    toggle,
    selectAll,
    selectNone,
    marqueeProps,
    actionFiles,
    selectedPaths,
    smartOptions,
  } = useOrganizeSelection({
    currentPath,
    visibleFiles,
    visiblePaths,
    filtered: clauses.length > 0,
  });
  // Shared-scroll grids can't reset themselves, so opening another folder or a changed
  // filter (a different result set) scrolls back to the top. Re-sorting, refetches and
  // streaming details never change the signature, so they never jump the page.
  const viewSig = `${currentPath}|${clauseSignature(clauses)}`;
  const lastViewSig = useRef(viewSig);
  useEffect(() => {
    if (lastViewSig.current === viewSig) return;
    lastViewSig.current = viewSig;
    scroller?.scrollTo({ top: 0 });
  }, [viewSig, scroller]);
  const { leavingFiles, leavingFolders, leaveFiles, leaveFolders, refreshListings } =
    useOrganizeExit();

  // Delete flows (shared confirm, chunked calls, empty-folder prompts) live in the
  // hook; the page reacts to what happened.
  const { deleteFiles, deleteFolder, deleting, progress } = useOrganizeDelete({
    redact,
    onFilesResult: (result: OrganizeDeleteResult) => {
      if (result.deleted.length === 0) return;
      // Failed paths are not in `deleted`, so they stay selected for a retry.
      setSelected((prev) => removeDeleted(prev, result.deleted));
      leaveFiles(result.deleted);
      refreshListings(EXIT_MS);
    },
    // Network/timeout: some files may already be gone.
    // Same delay as a result, so a partial run's exit animation still plays.
    onFilesError: () => refreshListings(EXIT_MS),
    onEmptyFolderDeleted: (path) => {
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) replaceFolder(up);
      leaveFolders([path], true);
      refreshListings(EXIT_MS);
    },
    onFolderDeleted: (path) => {
      // Parent of the deleted folder, even when it is an ancestor of the open one.
      const up = currentPath ? folderAfterDelete(path, currentPath) : null;
      if (up !== null) {
        replaceFolder(up);
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
    onFolderFailed: () => startScan.mutate(true),
    onGone: () => {
      markGone();
    },
  });

  // A file leaves the open folder (moved, renamed): drop it from the selection and
  // refetch, with the exit animation when it is leaving rather than changing name.
  const onFilesGone = (paths: string[], animate: boolean) => {
    setSelected((prev) => removeDeleted(prev, paths));
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
    markGone();
  };
  const move = useOrganizeMove({
    currentPath,
    actionFiles,
    selectedPaths,
    unavailable,
    redact,
    onFilesGone,
    onGone: () => dialogsOff(),
  });
  const rename = useOrganizeRename({
    currentPath,
    actionFiles,
    files: filesQ.data,
    subfolders: folderQ.data?.subfolders,
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

  const picker = (
    <OrganizeFolderPicker open={picking} onOpenChange={setPicking} onSelect={saveRoot.mutate} />
  );

  const header = (
    <div>
      <PageTitle>Organize</PageTitle>
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
          icon={FolderTree}
          title="Choose a folder to organize"
          description="Pick any folder and Organize will map it, count what is inside and let you delete files or whole folders safely."
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
      <OrganizeRootBar
        root={root}
        scan={scan}
        busy={saveRoot.isPending || startScan.isPending}
        onChangeFolder={() => setPicking(true)}
        onRescan={() => startScan.mutate(true)}
        redact={redact}
        onRedact={setRedact}
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
          error="Organize could not finish reading this folder."
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
            folderSort={
              folderQ.data && folderQ.data.subfolders.length > 0
                ? {
                    label: "Sort folders",
                    options: FOLDER_SORT_OPTIONS,
                    value: folderSort.sortKey,
                    dir: folderSort.sortDir,
                    onSort: folderSort.toggleSort,
                  }
                : undefined
            }
            fileSort={
              filesQ.data && filesQ.data.length > 0
                ? {
                    label: "Sort files",
                    options: FILE_SORT_OPTIONS,
                    value: fileSort.sortKey,
                    dir: fileSort.sortDir,
                    onSort: fileSort.toggleSort,
                  }
                : undefined
            }
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
            onRename={rename.openFolder}
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
            redact={redact}
          />
          {hasFiles &&
            (filesQ.isError ? (
              <QueryError error={filesQ.error} onRetry={() => void filesQ.refetch()} />
            ) : (
              <>
                {filesQ.data && (
                  <div className="space-y-3 rounded-lg border bg-card p-4">
                    <QueryBuilder
                      registry={organizeFields}
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
                    {!redact && <NameGroupChips names={fileNames} onPick={pickName} />}
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
                  redact={redact}
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
        <Button variant="outline" size="sm" disabled={deleting} onClick={move.openFolderDialog}>
          <FolderOutput className="mr-2 h-3.5 w-3.5" />
          Move to folder
        </Button>
        <Button variant="outline" size="sm" disabled={deleting} onClick={move.openSubfolderDialog}>
          <FolderInput className="mr-2 h-3.5 w-3.5" />
          Move to subfolder
        </Button>
        <Button variant="outline" size="sm" disabled={deleting} onClick={rename.openFiles}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Rename
        </Button>
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
      <MoveToSubfolderDialog {...move.subfolderDialogProps} />
      <MoveToFolderDialog {...move.folderDialogProps} />
      <RenameDialog {...rename.dialogProps} />
      {picker}
    </div>
  );
}
