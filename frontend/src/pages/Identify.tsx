import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle, Settings, Search, ChevronRight, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/api/queryKeys";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DirPicker } from "@/components/DirPicker";
import { SetupBar, type SelectedMedia, type IdentifyMode } from "@/components/identify/SetupBar";
import { MediaSearchDialog } from "@/components/identify/MediaSearchDialog";
import { MatchBoard } from "@/components/identify/MatchBoard";
import { CustomEpisodeList, type CustomRow } from "@/components/identify/CustomEpisodeList";
import { PreviewSheet } from "@/components/identify/PreviewSheet";
import { api } from "@/lib/api";
import type {
  SearchResult,
  Episode,
  RenameOp,
  NfoOp,
  ArtworkSpec,
  FileMapping,
} from "@/types/identify";
import { type FileGuess, buildInitialAssignments, slotKey } from "@/lib/episodeMatching";
import { orderFiles, cleanEpisodeTitle } from "@/lib/customShow";
import { Link } from "react-router-dom";

interface ApplyResult {
  successes: string[];
  failures: { path: string; error: string }[];
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

export function Identify() {
  const [folderPath, setFolderPath] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [mode, setMode] = useState<IdentifyMode>("tv");
  const [guessQuery, setGuessQuery] = useState("");
  const [selected, setSelected] = useState<SelectedMedia | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileGuesses, setFileGuesses] = useState<FileGuess[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // Custom-show mode
  const [showName, setShowName] = useState("");
  const [season, setSeason] = useState(1);
  const [order, setOrder] = useState<string[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [genericTitles, setGenericTitles] = useState(false);
  const [fileDates, setFileDates] = useState<Record<string, string | null> | null>(null);
  const [fileMtimes, setFileMtimes] = useState<Record<string, number>>({});
  const [activeSort, setActiveSort] = useState<"name" | "date" | "added" | "manual">("name");
  const [loadingDates, setLoadingDates] = useState(false);

  const [fileOps, setFileOps] = useState<RenameOp[]>([]);
  const [folderOps, setFolderOps] = useState<RenameOp[]>([]);
  const [nfoOps, setNfoOps] = useState<NfoOp[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [artwork, setArtwork] = useState<ArtworkSpec | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const [picking, setPicking] = useState(false);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");

  const tmdbType = mode === "movie" ? "movie" : "tv";

  const { data: settings } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });
  const hasTmdbKey = !!settings?.tmdb_api_key?.trim();

  async function loadFiles(path: string) {
    if (!path.trim()) return;
    setLoadingFiles(true);
    setError("");
    try {
      const res = await api.identifyFiles(path.trim());
      setFiles(res.files);
      setFileGuesses(res.file_guesses);
      setFileMtimes(res.mtimes);
      setOrder(orderFiles(res.files));
      setActiveSort("name");
      setShowName((prev) => prev || folderName(path));
      if (mode !== "custom" && res.guess.title) {
        setMode(res.guess.type);
        setGuessQuery(res.guess.title);
        if (hasTmdbKey) setSearchOpen(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function selectMedia(result: SearchResult) {
    const next: SelectedMedia = {
      tmdb_id: result.tmdb_id,
      title: result.title,
      year: result.year,
      type: tmdbType,
      number_of_seasons: result.number_of_seasons,
      poster_path: result.poster_path,
    };
    setSelected(next);
    setSearchOpen(false);
    setEpisodes([]);
    setAssignments({});

    if (mode === "movie") {
      const movieEpisode: Episode = {
        season_number: 1,
        episode_number: 1,
        name: result.title,
        overview: result.overview,
        still_path: null,
      };
      setEpisodes([movieEpisode]);
      if (files.length > 0) setAssignments({ [slotKey(1, 1)]: files[0]! });
      return;
    }

    setLoadingEpisodes(true);
    setError("");
    try {
      const eps = await api.identifyGetAllEpisodes(result.tmdb_id);
      if (eps.length === 0) throw new Error("No episodes returned for this show");
      eps.sort((a, b) =>
        a.season_number !== b.season_number
          ? a.season_number - b.season_number
          : a.episode_number - b.episode_number,
      );
      setEpisodes(eps);
      const slotKeys = new Set(eps.map((e) => slotKey(e.season_number, e.episode_number)));
      setAssignments(buildInitialAssignments(files, fileGuesses, slotKeys));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load episodes");
      setSelected(null);
    } finally {
      setLoadingEpisodes(false);
    }
  }

  function changeMode(m: IdentifyMode) {
    setMode(m);
    setSelected(null);
    setEpisodes([]);
    setAssignments({});
    if (m === "custom") {
      setOrder(orderFiles(files));
      setActiveSort("name");
      setShowName((prev) => prev || folderName(folderPath));
    }
  }

  function resolvedTitle(path: string, index: number): string {
    if (genericTitles) return `Episode ${index + 1}`;
    return titles[path] ?? cleanEpisodeTitle(path);
  }

  function reorder(fromPath: string, toPath: string) {
    setOrder((prev) => {
      const from = prev.indexOf(fromPath);
      const to = prev.indexOf(toPath);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return next;
    });
    setActiveSort("manual");
  }

  function setEpisodeNumber(path: string, episode: number) {
    setOrder((prev) => {
      const from = prev.indexOf(path);
      const to = Math.min(prev.length - 1, Math.max(0, episode - 1));
      if (from < 0 || from === to) return prev;
      const next = [...prev];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return next;
    });
    setActiveSort("manual");
  }

  async function sortBy(by: "name" | "date" | "added") {
    if (by === "name") {
      setOrder(orderFiles(files));
      setActiveSort("name");
      return;
    }
    if (by === "added") {
      setOrder((prev) => [...prev].sort((a, b) => (fileMtimes[a] ?? 0) - (fileMtimes[b] ?? 0)));
      setActiveSort("added");
      return;
    }
    let dates = fileDates;
    if (!dates) {
      setLoadingDates(true);
      try {
        dates = await api.identifyFileDates(folderPath.trim());
        setFileDates(dates);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to read upload dates");
        return;
      } finally {
        setLoadingDates(false);
      }
    }
    const d = dates;
    if (!Object.values(d).some((v) => v !== null)) return; // no dates embedded — leave order as-is
    setOrder((prev) => [...prev].sort((a, b) => (d[a] ?? "9999").localeCompare(d[b] ?? "9999")));
    setActiveSort("date");
  }

  async function openPreview() {
    setPreviewOpen(true);
    setApplyResult(null);
    setPreviewError("");
    setLoadingPreview(true);
    try {
      let mappings: FileMapping[];
      let body: Parameters<typeof api.identifyPreview>[0];
      if (mode === "custom") {
        mappings = order.map((path, i) => ({
          file_path: path,
          season_number: season,
          episode_number: i + 1,
          episode_name: resolvedTitle(path, i),
        }));
        body = {
          folder_path: folderPath.trim(),
          type: "tv" as const,
          title: showName.trim(),
          year: null,
          tmdb_id: null,
          mappings,
          target_dir: targetDir.trim() || null,
          write_nfo: true,
        };
      } else {
        if (!selected) return;
        const fileToSlot = new Map<string, string>();
        for (const [key, fp] of Object.entries(assignments)) fileToSlot.set(fp, key);
        mappings = files.map((fp) => {
          const key = fileToSlot.get(fp);
          const ep = key
            ? episodes.find((e) => slotKey(e.season_number, e.episode_number) === key)
            : undefined;
          return {
            file_path: fp,
            season_number: ep?.season_number ?? null,
            episode_number: ep?.episode_number ?? null,
            episode_name: ep?.name ?? null,
          };
        });
        body = {
          folder_path: folderPath.trim(),
          type: tmdbType,
          title: selected.title,
          year: selected.year,
          tmdb_id: selected.tmdb_id,
          mappings,
          target_dir: targetDir.trim() || null,
          write_nfo: false,
        };
      }
      const res = await api.identifyPreview(body);
      setFileOps(res.file_ops);
      setFolderOps(res.folder_ops);
      setNfoOps(res.nfo_ops);
      setImagePaths(res.image_paths);
      setArtwork(res.artwork);
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doApply() {
    setLoadingApply(true);
    setPreviewError("");
    try {
      const res = await api.identifyApply({
        file_ops: fileOps,
        folder_ops: folderOps,
        nfo_ops: nfoOps,
        artwork,
      });
      setApplyResult({ successes: res.successes, failures: res.failures });
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setLoadingApply(false);
    }
  }

  function handleSourceSelect(path: string) {
    setFolderPath(path);
    setPicking(false);
    setFiles([]);
    setFileGuesses([]);
    setSelected(null);
    setEpisodes([]);
    setAssignments({});
    setOrder([]);
    setTitles({});
    setFileDates(null);
    setFileMtimes({});
    setShowName("");
    setError("");
    loadFiles(path);
  }

  function reset() {
    setFolderPath("");
    setTargetDir("");
    setGuessQuery("");
    setSelected(null);
    setEpisodes([]);
    setFiles([]);
    setFileGuesses([]);
    setAssignments({});
    setShowName("");
    setSeason(1);
    setOrder([]);
    setTitles({});
    setGenericTitles(false);
    setFileDates(null);
    setFileMtimes({});
    setActiveSort("name");
    setFileOps([]);
    setFolderOps([]);
    setNfoOps([]);
    setImagePaths([]);
    setArtwork(null);
    setApplyResult(null);
    setPreviewOpen(false);
    setSearchOpen(false);
    setError("");
    setPreviewError("");
  }

  const tmdbReady = selected !== null && episodes.length > 0;
  const customReady = mode === "custom" && files.length > 0;
  const workReady = mode === "custom" ? customReady : tmdbReady;
  const matched = Object.keys(assignments).length;
  const canPreview = mode === "custom" ? customReady && showName.trim().length > 0 : tmdbReady;

  const customRows: CustomRow[] = order.map((path, i) => ({
    path,
    episode: i + 1,
    title: resolvedTitle(path, i),
  }));
  const datesUnavailable = fileDates !== null && Object.values(fileDates).every((v) => v === null);

  return (
    <div className="flex min-h-full flex-col p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Identify &amp; Rename</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Point at a folder of badly-named files and rename them to Plex/Jellyfin format.
        </p>
        <Link
          to="/settings?tab=credentials"
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings className="h-3 w-3" />
          TMDB API key needed for TV/Movie matching — configure in Settings → Keys &amp; Accounts
        </Link>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <SetupBar
          folderPath={folderPath}
          fileCount={files.length}
          loadingFiles={loadingFiles}
          onBrowseSource={() => setPicking(true)}
          targetDir={targetDir}
          onBrowseTarget={() => setPickingTarget(true)}
          onClearTarget={() => setTargetDir("")}
          mode={mode}
          onModeChange={changeMode}
          selected={selected}
          loadingEpisodes={loadingEpisodes}
          episodeCount={episodes.length}
          onOpenSearch={() => setSearchOpen(true)}
          showName={showName}
          onShowNameChange={setShowName}
          season={season}
          onSeasonChange={setSeason}
        />

        {mode === "custom" && customReady ? (
          <CustomEpisodeList
            rows={customRows}
            season={season}
            onTitleEdit={(path, v) => setTitles((prev) => ({ ...prev, [path]: v }))}
            onReorder={reorder}
            onSetEpisode={setEpisodeNumber}
            onSort={sortBy}
            onReverse={() => {
              setOrder((prev) => [...prev].reverse());
              setActiveSort("manual");
            }}
            genericTitles={genericTitles}
            onGenericTitlesChange={setGenericTitles}
            activeSort={activeSort}
            datesLoading={loadingDates}
            datesUnavailable={datesUnavailable}
          />
        ) : mode !== "custom" && tmdbReady ? (
          <MatchBoard
            key={selected!.tmdb_id}
            files={files}
            episodes={episodes}
            mediaType={tmdbType}
            assignments={assignments}
            onAssignmentsChange={setAssignments}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border py-16 text-center">
            {loadingEpisodes ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="rounded-full bg-muted p-3">
                  {folderPath ? (
                    <Search className="h-6 w-6 text-muted-foreground" />
                  ) : (
                    <FolderOpen className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {!folderPath
                    ? "Pick a source folder to begin."
                    : !hasTmdbKey
                      ? `${files.length} file${
                          files.length === 1 ? "" : "s"
                        } loaded — no TMDB key, so use a custom show (or add a key in Settings).`
                      : `${files.length} file${files.length === 1 ? "" : "s"} loaded — find the ${
                          mode === "tv" ? "show" : "movie"
                        } to match them against.`}
                </p>
                {folderPath &&
                  mode !== "custom" &&
                  (hasTmdbKey ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSearchOpen(true)}
                    >
                      <Search className="h-4 w-4" />
                      Search TMDB
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => changeMode("custom")}
                    >
                      Use a custom show
                    </Button>
                  ))}
              </>
            )}
          </div>
        )}
      </div>

      {workReady && (
        <div className="sticky bottom-14 md:bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border bg-[var(--px-bg-base)]/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <p className="text-sm text-muted-foreground">
            {mode === "custom" ? (
              <>
                <span className="font-mono font-medium text-foreground">{order.length}</span>{" "}
                episode{order.length === 1 ? "" : "s"}
              </>
            ) : (
              <>
                <span className="font-mono font-medium text-foreground">
                  {matched}/{episodes.length}
                </span>{" "}
                matched
              </>
            )}
          </p>
          <Button type="button" onClick={openPreview} disabled={!canPreview} className="gap-2">
            Preview renames
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <MediaSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        mediaType={tmdbType}
        onMediaTypeChange={(t) => changeMode(t)}
        initialQuery={guessQuery}
        selectedId={selected?.tmdb_id ?? null}
        onPick={selectMedia}
        onUseCustom={() => {
          setSearchOpen(false);
          changeMode("custom");
        }}
      />

      <PreviewSheet
        open={previewOpen}
        onOpenChange={(o) => {
          setPreviewOpen(o);
          if (!o && applyResult) reset();
        }}
        loadingPreview={loadingPreview}
        fileOps={fileOps}
        folderOps={folderOps}
        nfoOps={nfoOps}
        imagePaths={imagePaths}
        loadingApply={loadingApply}
        onApply={doApply}
        result={applyResult}
        onReset={reset}
        error={previewError}
      />

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select source folder</DialogTitle>
          </DialogHeader>
          <DirPicker onSelect={handleSourceSelect} onClose={() => setPicking(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={pickingTarget} onOpenChange={setPickingTarget}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move renamed folder to…</DialogTitle>
          </DialogHeader>
          <DirPicker
            onSelect={(path) => {
              setTargetDir(path);
              setPickingTarget(false);
            }}
            onClose={() => setPickingTarget(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
