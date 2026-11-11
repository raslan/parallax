import { useState } from "react";
import { isConflict, isMissing } from "@/lib/api/client";
import { formatSize, sumSizeOf } from "@/lib/format";
import { invertSelection } from "@/lib/organizeSelect";
import { clauseSignature } from "@/lib/organizeScroll";
import {
  FILE_SORT_OPTIONS,
  FOLDER_SORT_OPTIONS,
  fileSortDefaultDir,
  folderSortDefaultDir,
  type FileSortKey,
  type FolderSortKey,
} from "@/lib/organizeSort";
import { PageTitle } from "@/components/PageTitle";
import { QueryError } from "@/components/QueryError";
import { PageSkeleton } from "@/components/Skeletons";
import { StatPanel } from "@/components/StatPanel";
import { WorkingState } from "@/components/WorkingState";
import type { ViewMode } from "@/components/DataToolbar";
import { BrowseControls } from "@/components/organize/BrowseControls";
import { FileBrowser } from "@/components/organize/FileBrowser";
import { FolderBrowser } from "@/components/organize/FolderBrowser";
import { MoveToFolderDialog } from "@/components/organize/MoveToFolderDialog";
import { MoveToSubfolderDialog } from "@/components/organize/MoveToSubfolderDialog";
import { OrganizeFilterCard } from "@/components/organize/OrganizeFilterCard";
import { OrganizeFolderPicker } from "@/components/organize/OrganizeFolderPicker";
import { OrganizeRootBar } from "@/components/organize/OrganizeRootBar";
import { OrganizeSelectionDock } from "@/components/organize/OrganizeSelectionDock";
import { GoneState, NoRootState, UnavailableState } from "@/components/organize/OrganizeStates";
import { RenameDialog } from "@/components/organize/RenameDialog";
import { TagPanel } from "@/components/organize/TagPanel";
import { useGridSize } from "@/hooks/useGridSize";
import { useOrganizeActions } from "@/hooks/useOrganizeActions";
import { useOrganizeBrowse } from "@/hooks/useOrganizeBrowse";
import { useOrganizeExit } from "@/hooks/useOrganizeExit";
import { useOrganizeFilters } from "@/hooks/useOrganizeFilters";
import { useOrganizeRoot } from "@/hooks/useOrganizeRoot";
import { useOrganizeSelection } from "@/hooks/useOrganizeSelection";
import { useScrollParent } from "@/hooks/useScrollParent";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";
import { useSort } from "@/hooks/useSort";
import { useOrganizeTagEdits } from "@/hooks/useOrganizeTagEdits";
import { useOrganizeTagPanel } from "@/hooks/useOrganizeTagPanel";
import { useTagColumns } from "@/hooks/useTagColumns";
import { useTagPanelOpen } from "@/hooks/useTagPanelOpen";

/** Tools → Organize: walk a folder by hand. State and flows live in the hooks above. */
export function Organize() {
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
  } = useOrganizeRoot({
    // A rescan or a new root starts over: the selection and any staged tag edits go.
    onReset: () => {
      selectNone();
      edits.clearAll();
    },
  });
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
  const [tagColumns, setTagColumns] = useTagColumns();
  const [panelOn, setPanelOn] = useTagPanelOpen();
  const filters = useOrganizeFilters(fileList, detailsProgress, fileSort, {
    folderPath: currentPath ?? "",
    // The whole folder's tags are read only for a visible tag column (list view) or a tag
    // filter. The panel reads just the selected files itself.
    wanted: viewMode === "list" && tagColumns.length > 0,
  });
  const { tags, done: tagsDone } = filters.tagsProgress;
  // The panel follows the selection: it shows while the switch is on and files are selected.
  const { clauses, visiblePaths } = filters;
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
    visibleFiles: filters.visibleFiles,
    visiblePaths,
    filtered: clauses.length > 0,
  });
  // Opening another folder or changing a filter shows a different result set.
  useScrollTopOnChange(scroller, `${currentPath}|${clauseSignature(clauses)}`);
  const panel = useOrganizeTagPanel({
    folderPath: currentPath ?? "",
    files: actionFiles,
    tags,
    enabled: panelOn,
  });
  const exit = useOrganizeExit();
  const edits = useOrganizeTagEdits({
    folderPath: currentPath ?? "",
    files: actionFiles,
    redact,
    // Written files changed on disk, so their cached tags and the listing (size) are read again.
    onWritten: (paths) => {
      filters.tagsProgress.forget(paths);
      panel.forget(paths);
      exit.refreshListings();
    },
    onGone: markGone,
  });
  const { move, rename, deleteFiles, deleteFolder, deleting, progress } = useOrganizeActions({
    currentPath,
    redact,
    unavailable,
    actionFiles,
    selectedPaths,
    setSelected,
    files: filesQ.data,
    subfolders: folderQ.data?.subfolders,
    exit,
    replaceFolder,
    rescan: () => startScan.mutate(true),
    markGone,
    onPathsGone: edits.drop,
  });

  const picker = (
    <OrganizeFolderPicker open={picking} onOpenChange={setPicking} onSelect={saveRoot.mutate} />
  );

  const header = (
    <div>
      <PageTitle>Organize</PageTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        Work on a folder by hand: browse it, find files, rename or move them, look at their tags and
        delete what you do not need.
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
        <NoRootState onChoose={() => setPicking(true)} />
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
        <UnavailableState onChangeFolder={() => setPicking(true)} />
      ) : scan?.status === "error" ? (
        <QueryError
          title="The scan failed"
          error="Organize could not finish reading this folder."
          onRetry={() => startScan.mutate(true)}
        />
      ) : badPath ||
        (folderQ.isError && !atRoot && (isMissing(folderQ.error) || isConflict(folderQ.error))) ? (
        <GoneState />
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
            tagColumns={{ selected: tagColumns, onChange: setTagColumns }}
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
            leaving={exit.leavingFolders}
            redact={redact}
          />
          {hasFiles &&
            (filesQ.isError ? (
              <QueryError error={filesQ.error} onRetry={() => void filesQ.refetch()} />
            ) : (
              <>
                {filesQ.data && (
                  <OrganizeFilterCard
                    clauses={clauses}
                    fieldsByKey={filters.fieldsByKey}
                    onAdd={filters.addClause}
                    onRemove={filters.removeClause}
                    onUpdate={filters.updateClause}
                    stillLoading={filters.stillLoading}
                    redact={redact}
                    fileNames={filters.fileNames}
                    onPickName={filters.pickName}
                    smartOptions={smartOptions}
                    visibleCount={visiblePaths.length}
                    hasSelection={selected.size > 0}
                    onInvert={() => selectAll(invertSelection(visiblePaths, selected))}
                    onClear={selectNone}
                  />
                )}
                <FileBrowser
                  files={filesQ.data ? filters.sortedFiles : undefined}
                  sortKey={fileSort.sortKey}
                  sortDir={fileSort.sortDir}
                  onSort={fileSort.toggleSort}
                  details={detailsProgress.details}
                  progress={detailsProgress}
                  selected={selected}
                  leaving={exit.leavingFiles}
                  onToggleSelect={(f) => toggle(f.path)}
                  filtered={clauses.length > 0}
                  viewMode={viewMode}
                  cardSize={cardSize}
                  scrollElement={scroller}
                  marquee={marqueeProps}
                  redact={redact}
                  tagColumns={tagColumns}
                  tags={tags}
                  tagsLoading={!tagsDone}
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
      <OrganizeSelectionDock
        count={actionFiles.length}
        bytes={sumSizeOf(actionFiles, selectedPaths, (f) => f.path)}
        deleting={deleting}
        progress={progress}
        onClear={selectNone}
        onMoveToFolder={move.openFolderDialog}
        onMoveToSubfolder={move.openSubfolderDialog}
        onRename={rename.openFiles}
        onTags={() => setPanelOn(!panelOn)}
        editedCount={actionFiles.filter((f) => f.path in edits.staged).length}
        onDelete={() => void deleteFiles(actionFiles)}
      />
      <MoveToSubfolderDialog {...move.subfolderDialogProps} />
      <MoveToFolderDialog {...move.folderDialogProps} />
      <RenameDialog {...rename.dialogProps} />
      <TagPanel
        open={panelOn && actionFiles.length > 0}
        onOpenChange={(next) => {
          setPanelOn(next);
          if (!next) edits.closeReview();
        }}
        files={actionFiles}
        infos={panel.infos}
        loading={panel.loading}
        redact={redact}
        edits={edits}
      />
      {picker}
    </div>
  );
}
