import { useMemo, useState } from "react";
import { Captions, FolderSearch, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, qk, speechModelsApi, subtitlePacksApi, subtitlesApi } from "@/lib/api";
import { attention, blockedReasons, coverage } from "@/lib/subtitleCoverage";
import {
  seasonCount,
  sortTitleFiles,
  TITLE_FILE_SORTS,
  type TitleFileSort,
} from "@/lib/subtitleGroups";
import { filterByFilename } from "@/components/FileSelectGrid";
import type { ViewMode } from "@/components/DataToolbar";
import { EmptyState } from "@/components/EmptyState";
import { PageTitle } from "@/components/PageTitle";
import { QueryError } from "@/components/QueryError";
import { SectionHeader } from "@/components/SectionHeader";
import { GridSkeleton } from "@/components/Skeletons";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { WorkingState } from "@/components/WorkingState";
import { Button } from "@/components/ui/button";
import { BrowseControls } from "@/components/organize/BrowseControls";
import { ActivityBar } from "@/components/subtitles/ActivityBar";
import { CompareSheet } from "@/components/subtitles/CompareSheet";
import { FolderStrip } from "@/components/subtitles/FolderStrip";
import { ManagePanel } from "@/components/subtitles/ManagePanel";
import { SubtitleRenameDialog } from "@/components/subtitles/SubtitleRenameDialog";
import { SubtitleDock } from "@/components/subtitles/SubtitleDock";
import { SummaryStrip } from "@/components/subtitles/SummaryStrip";
import { TitleCard } from "@/components/subtitles/TitleCard";
import { TitleFiles, type AttentionFilter } from "@/components/subtitles/TitleFiles";
import { UnmatchedNotice } from "@/components/subtitles/UnmatchedNotice";
import { WorkflowView } from "@/components/subtitles/WorkflowView";
import { useGridSize } from "@/hooks/useGridSize";
import { useScrollParent } from "@/hooks/useScrollParent";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { useSubtitleActions } from "@/hooks/useSubtitleActions";
import { useSubtitleActivity } from "@/hooks/useSubtitleActivity";
import { useSubtitleCompare } from "@/hooks/useSubtitleCompare";
import { useSubtitleFolder } from "@/hooks/useSubtitleFolder";
import { useSubtitleManage } from "@/hooks/useSubtitleManage";
import { useSubtitlePanelOpen } from "@/hooks/useSubtitlePanelOpen";
import { useSubtitleWorkflow } from "@/hooks/useSubtitleWorkflow";
import type { SyncEngine } from "@/lib/subtitleRunDock";
import type { ScanFile, SubtitleProvider } from "@/types/subtitle";

const parseLanguages = (raw: string | undefined) =>
  (raw || "en")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

/**
 * Tools → Subtitles, the Home view: the folder (from the URL), what is on disk in it, a
 * card per title, the subtitle work running on it, and a dock acting on the selected
 * titles or files. Nothing about a folder is remembered: every count is read from disk.
 */
export function Subtitles() {
  const activity = useSubtitleActivity();
  const f = useSubtitleFolder(activity.activeFor);
  const { folder, titles, files, lengths } = f;
  const actions = useSubtitleActions(folder);

  // Wanted starts from Settings each visit; a change here lives until the page is left.
  // Until Settings has answered the chips stay empty (no English flash); if it cannot be
  // read, English is the starting point, as in Settings.
  const settingsQ = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });
  const [wantedEdit, setWantedEdit] = useState<string[] | null>(null);
  const savedLanguages = settingsQ.data?.subtitle_languages;
  const wantedKnown = useMemo(
    () => wantedEdit ?? (settingsQ.isPending ? null : parseLanguages(savedLanguages)),
    [wantedEdit, settingsQ.isPending, savedLanguages],
  );
  const wanted = useMemo(() => wantedKnown ?? [], [wantedKnown]);
  const [sources, setSources] = useState<SubtitleProvider[]>(["subf2m", "yts"]);

  // Not known (loading or failed) is not "none installed": it disables nothing.
  const packsQ = useQuery({
    queryKey: qk.subtitlePacks(),
    queryFn: () => subtitlePacksApi.list(),
  });
  const modelsQ = useQuery({
    queryKey: qk.speechModels(),
    queryFn: () => speechModelsApi.list(),
  });
  const blocked = blockedReasons({
    speechModelReady: modelsQ.isSuccess ? modelsQ.data.some((m) => m.active && m.installed) : null,
    packsInstalled: packsQ.isSuccess ? packsQ.data.filter((p) => p.installed).length : null,
  });

  // Find subtitles (Titles → Plan → Run) and Generated and translated, over the Home view.
  const w = useSubtitleWorkflow({ folder, titles, wanted, sources });
  const syncEngine: SyncEngine =
    settingsQ.data?.subtitle_sync_engine === "ffsubsync" ? "ffsubsync" : "alass";
  const compare = useSubtitleCompare({
    files,
    chooseCandidate: w.plan.chooseCandidate,
    setVerdict: w.plan.setVerdict,
    retry: w.retry,
    // Sync, Find another and Delete on an existing subtitle are the Manage panel's actions.
    onExisting: (v, video, file, stray) =>
      manage.act(
        video,
        v === "sync"
          ? { type: "sync", path: file.path, engine: syncEngine }
          : v === "delete"
            ? stray
              ? { type: "stray_delete", paths: [file.path] }
              : { type: "delete", paths: [file.path] }
            : { type: "find" },
      ),
  });

  // Manage: while it is switched on the panel shows the single selected video. A row's
  // Manage entry selects that video; it is not a separate way of choosing one.
  const [panelOn, setPanelOn] = useSubtitlePanelOpen();
  const [renaming, setRenaming] = useState<{
    /** null for a subtitle found beside no video. */
    video: { path: string; name: string } | null;
    file: { path: string; name: string };
  } | null>(null);
  const manage = useSubtitleManage({
    folder,
    ui: {
      compare: (videoPath, file) => {
        const v = files.find((x) => x.path === videoPath);
        if (v) compare.openExisting({ path: v.path, name: v.filename }, file);
      },
      compareStray: (videoPath, u) => {
        const v = files.find((x) => x.path === videoPath);
        if (v)
          compare.openExisting(
            { path: v.path, name: v.filename },
            {
              path: u.path,
              name: u.name,
              language: u.language ?? "und",
              label: null,
              kind: "real",
              size: 0,
              directory: u.directory,
            },
            true,
          );
      },
      rename: (videoPath, file) => {
        const v = files.find((x) => x.path === videoPath);
        if (v) setRenaming({ video: { path: v.path, name: v.filename }, file });
      },
      renameStray: (file) => setRenaming({ video: null, file }),
      find: (videoPath) => {
        setPanelOn(false);
        w.startFind(files.filter((x) => x.path === videoPath));
      },
      translate: (videoPath) => w.openMachine(files.filter((x) => x.path === videoPath)),
      generate: (videoPath) => w.openMachine(files.filter((x) => x.path === videoPath)),
    },
  });
  const titleOf = useMemo(() => {
    const byVideo = new Map<string, { key: string; name: string }>();
    for (const t of titles) {
      const name = t.group.year ? `${t.group.title} (${t.group.year})` : t.group.title;
      for (const x of t.files) byVideo.set(x.path, { key: t.group.key, name });
    }
    return (video: string) => byVideo.get(video) ?? { key: "other-files", name: "Other files" };
  }, [titles]);
  const runQueuePosition = f.folderJobs.find((j) => j.id === w.runJob.id)?.queue_position ?? null;

  // A lone title opens straight into itself.
  const openKey = f.titleKey ?? (titles.length === 1 ? (titles[0]?.group.key ?? null) : null);
  const open = useMemo(
    () => titles.find((t) => t.group.key === openKey) ?? null,
    [titles, openKey],
  );

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [cardSize, setCardSize] = useGridSize(240);
  const [scroller, pageRef] = useScrollParent();
  const sort = useSort<TitleFileSort>("episode");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<AttentionFilter>("all");
  const [playing, setPlaying] = useState<ScanFile | null>(null);

  const titleSel = useSelection<string>();
  const fileSel = useSelection<string>();
  // Another folder or title starts with nothing selected and the whole title shown.
  const [shown, setShown] = useState(`${folder}|${openKey}`);
  if (shown !== `${folder}|${openKey}`) {
    setShown(`${folder}|${openKey}`);
    titleSel.selectNone();
    fileSel.selectNone();
    setShow("all");
    setSearch("");
  }
  useScrollTopOnChange(scroller, `${folder}|${openKey}`);

  const folderCoverage = useMemo(() => coverage(files, wanted), [files, wanted]);
  const titleCoverage = useMemo(
    () => new Map(titles.map((t) => [t.group.key, coverage(t.files, wanted)])),
    [titles, wanted],
  );
  const flags = useMemo(
    () => attention(open?.files ?? [], wanted, lengths.byPath),
    [open, wanted, lengths.byPath],
  );
  const visibleFiles = useMemo(() => {
    if (!open) return [];
    const all = open.files;
    const filtered = show === "all" ? all : all.filter((x) => flags[show].has(x.path));
    return sortTitleFiles(filterByFilename(filtered, search), sort.sortKey, sort.sortDir);
  }, [open, show, flags, search, sort.sortKey, sort.sortDir]);
  const visiblePaths = useMemo(() => visibleFiles.map((x) => x.path), [visibleFiles]);
  useSelectionOrder(fileSel.setOrder, visiblePaths);

  const selectedPaths = [...fileSel.selected];
  const managedPath = panelOn && selectedPaths.length === 1 ? (selectedPaths[0] ?? null) : null;
  const managed = managedPath ? (files.find((x) => x.path === managedPath) ?? null) : null;
  // The scan already carries each video's files, so the panel opens with them and then reads
  // the video's own list, which a rename or delete refreshes at once.
  const managedFilesQ = useQuery({
    queryKey: qk.subtitleFiles(managed?.path ?? ""),
    queryFn: () => subtitlesApi.files(managed?.path ?? ""),
    enabled: managed !== null,
    placeholderData: managed?.subtitles,
  });
  const openManage = (path: string) => {
    fileSel.selectAll([path]);
    setPanelOn(true);
  };
  const closeManage = () => setPanelOn(false);
  // Every name in a folder (videos and subtitles), so a rename to a taken one is refused here.
  const takenIn = (dir: string) => {
    const names = new Set<string>();
    const inDir = (p: string) => p.slice(0, p.lastIndexOf("/")) === dir;
    for (const x of files) {
      if (inDir(x.path)) names.add(x.filename);
      for (const s of x.subtitles) if (inDir(s.path)) names.add(s.name);
    }
    for (const s of managedFilesQ.data ?? []) if (inDir(s.path)) names.add(s.name);
    for (const u of f.unmatchedQ.data ?? []) if (inDir(u.path)) names.add(u.name);
    return names;
  };

  // What the dock acts on: the selected files of the open title, else the selected titles.
  const actionFiles = open
    ? visibleFiles.filter((x) => fileSel.selected.has(x.path))
    : titles.filter((t) => titleSel.selected.has(t.group.key)).flatMap((t) => t.files);
  const selectedCount = open
    ? actionFiles.length
    : titles.filter((t) => titleSel.selected.has(t.group.key)).length;
  const scope = open ? [open] : titles;
  const ytsReason =
    scope.length > 0 && scope.every((t) => t.group.type === "tv")
      ? "YTS has subtitles for films only"
      : null;

  const header = (
    <div>
      <PageTitle>Subtitles</PageTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        See, find and manage subtitles for a folder of videos.
      </p>
    </div>
  );

  const body = () => {
    if (f.badPath)
      return (
        <QueryError title="This is not a folder path" error="Type or pick an absolute folder." />
      );
    if (folder === null)
      return (
        <EmptyState
          icon={FolderSearch}
          title="Pick a folder of videos"
          description="Type a folder above or use Browse. Parallax reads what subtitles each video already has; nothing changes until you say so."
        />
      );
    if (f.scanQ.isPending)
      return (
        <WorkingState
          title="Reading the folder"
          message={`Looking through ${folder}, its subfolders, and sibling Subs or Subtitles folders.`}
          progress={null}
        />
      );
    if (f.scanQ.isError)
      return <QueryError error={f.scanQ.error} onRetry={() => void f.scanQ.refetch()} />;
    if (files.length === 0)
      return (
        <EmptyState
          icon={Captions}
          title="No videos in this folder"
          description="Parallax looks in this folder, its subfolders, and sibling Subs or Subtitles folders. Pick another folder if you expected videos here."
        />
      );
    return (
      <div className="animate-slide-up-fade space-y-4">
        <SummaryStrip
          titles={titles.length}
          files={files.length}
          wanted={wanted}
          coverage={folderCoverage}
        />
        {!lengths.done && (
          <p className="text-xs text-muted-foreground tabular-nums" role="status">
            Checking lengths {lengths.loaded} of {lengths.total}
          </p>
        )}
        <UnmatchedNotice files={f.unmatchedQ.data ?? []} />
        {f.groupsQ.isError ? (
          <QueryError error={f.groupsQ.error} onRetry={() => void f.groupsQ.refetch()} />
        ) : f.groupsQ.isPending ? (
          <GridSkeleton count={4} minColumnWidth={260} />
        ) : open ? (
          <>
            <BrowseControls
              viewMode={viewMode}
              onViewMode={setViewMode}
              size={cardSize}
              onSize={setCardSize}
              fileSort={{
                label: "Sort files",
                options: TITLE_FILE_SORTS,
                value: sort.sortKey,
                dir: sort.sortDir,
                onSort: sort.toggleSort,
              }}
            />
            <TitleFiles
              titles={titles}
              openKey={open.group.key}
              onOpenTitle={f.openTitle}
              files={visibleFiles}
              totalFiles={open.files.length}
              wanted={wanted}
              lengths={lengths.byPath}
              search={search}
              onSearch={setSearch}
              show={show}
              onShow={setShow}
              counts={{
                all: open.files.length,
                missing: flags.missing.size,
                machineOnly: flags.machineOnly.size,
                looksShort: flags.looksShort.size,
                hasBackup: flags.hasBackup.size,
              }}
              selected={fileSel.selected}
              onToggleSelect={fileSel.toggle}
              onPlay={setPlaying}
              onManage={(x) => openManage(x.path)}
              viewMode={viewMode}
              cardSize={cardSize}
              scrollElement={scroller}
              marquee={fileSel.marqueeProps}
            />
          </>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <SectionHeader>Titles · {titles.length}</SectionHeader>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => titleSel.selectAll(titles.map((t) => t.group.key))}
              >
                Select all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() => w.startFind(files)}
              >
                <Search className="mr-1.5 h-3.5 w-3.5" />
                Find subtitles for this folder
              </Button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {titles.map((t) => (
                <TitleCard
                  key={t.group.key}
                  group={t.group}
                  files={t.files.length}
                  seasons={seasonCount(t.files)}
                  wanted={wanted}
                  coverage={titleCoverage.get(t.group.key) ?? {}}
                  selected={titleSel.selected.has(t.group.key)}
                  onToggleSelect={() => titleSel.toggle(t.group.key)}
                  onOpen={() => f.openTitle(t.group.key)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div ref={pageRef} className="space-y-6 p-4 pb-32 md:p-8 md:pb-24">
      {header}
      <FolderStrip
        key={folder ?? ""}
        folder={folder}
        scanning={f.scanQ.isFetching}
        onOpen={f.openFolder}
        onRescan={f.rescan}
        wanted={wantedKnown}
        onWantedChange={setWantedEdit}
        sources={sources}
        onSourcesChange={setSources}
        ytsReason={ytsReason}
      />
      {(w.wf?.stage === "titles" || w.wf?.stage === "plan") && (
        <p className="-mt-3 text-3xs text-muted-foreground">
          Changes to Wanted and Sources apply to the next search.
        </p>
      )}
      {w.wf ? (
        <WorkflowView
          w={w}
          hasTmdbKey={!!settingsQ.data?.tmdb_api_key}
          settingsEngine={settingsQ.data?.subtitle_sync_engine ?? "alass"}
          packs={packsQ.isSuccess ? packsQ.data : null}
          models={modelsQ.isSuccess ? modelsQ.data : null}
          blocked={blocked}
          titleOf={titleOf}
          queuePosition={runQueuePosition}
          cancelling={w.runJob.id != null && actions.cancelling.has(w.runJob.id)}
          onCancel={actions.cancel}
          onCompareRow={compare.openRow}
          onCompareItem={compare.openItem}
          comparingItem={compare.searchingItem}
        />
      ) : (
        <>
          <ActivityBar
            jobs={f.folderJobs}
            cancelling={actions.cancelling}
            onCancel={actions.cancel}
            onOpenRun={w.openRun}
          />
          {body()}
          <SubtitleDock
            count={selectedCount}
            files={actionFiles.length}
            blocked={blocked}
            syncing={actions.syncing}
            onFind={() => w.startFind(actionFiles)}
            onTranslate={() => w.openMachine(actionFiles)}
            onGenerate={() => w.openMachine(actionFiles)}
            onSync={() => actions.sync(actionFiles)}
            onManage={() => actionFiles[0] && openManage(actionFiles[0].path)}
            onClear={() => {
              titleSel.selectNone();
              fileSel.selectNone();
            }}
          />
        </>
      )}
      {compare.sheet && (
        <CompareSheet
          key={`${compare.sheet.video.path}|${compare.sheet.existing?.path ?? ""}`}
          video={compare.sheet.video}
          mode={compare.sheet.mode}
          candidates={compare.sheet.candidates}
          existing={compare.sheet.existing}
          unmatchedRoot={compare.sheet.stray && folder !== null ? folder : undefined}
          onVerdict={compare.verdict}
          onClose={compare.close}
        />
      )}
      {managed && !compare.sheet && !w.wf && (
        <ManagePanel
          key={managed.path}
          video={{ path: managed.path, name: managed.filename }}
          files={managedFilesQ.data ?? managed.subtitles}
          unmatched={f.unmatchedQ.data ?? []}
          speechModelReady={
            modelsQ.isSuccess ? modelsQ.data.some((m) => m.active && m.installed) : null
          }
          installedPacks={
            packsQ.isSuccess ? packsQ.data.filter((p) => p.installed).map((p) => p.lang) : null
          }
          defaultEngine={syncEngine}
          onAct={(a) => void manage.act({ path: managed.path, name: managed.filename }, a)}
          onClose={closeManage}
        />
      )}
      <SubtitleRenameDialog
        open={renaming !== null}
        file={renaming?.file ?? null}
        videoName={renaming?.video?.name ?? null}
        taken={takenIn(
          renaming ? renaming.file.path.slice(0, renaming.file.path.lastIndexOf("/")) : "",
        )}
        onSubmit={(name) =>
          !renaming
            ? Promise.resolve()
            : renaming.video
              ? manage.rename(renaming.video, renaming.file.path, name)
              : manage.renameStray(renaming.file.path, name)
        }
        onOpenChange={(o) => !o && setRenaming(null)}
      />{" "}
      {playing && (
        <VideoPlayerModal
          file={{ id: 0, filename: playing.filename, path: playing.path }}
          streamUrl={subtitlesApi.streamUrl(playing.path)}
          subtitleTracksUrl={subtitlesApi.tracksUrl(playing.path)}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
