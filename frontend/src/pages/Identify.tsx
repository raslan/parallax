import { useState } from "react";
import { Loader2, AlertCircle, Settings, Search, ChevronRight, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DirPicker } from "@/components/DirPicker";
import { SetupBar, type SelectedMedia } from "@/components/identify/SetupBar";
import { MediaSearchDialog } from "@/components/identify/MediaSearchDialog";
import { MatchBoard } from "@/components/identify/MatchBoard";
import { PreviewSheet } from "@/components/identify/PreviewSheet";
import { api } from "@/lib/api";
import type { SearchResult, Episode, RenameOp, FileMapping } from "@/types/identify";
import { type FileGuess, buildInitialAssignments, slotKey } from "@/lib/episodeMatching";
import { Link } from "react-router-dom";

type MediaType = "movie" | "tv";
interface ApplyResult {
  successes: string[];
  failures: { path: string; error: string }[];
}

export function Identify() {
  const [folderPath, setFolderPath] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("tv");
  const [guessQuery, setGuessQuery] = useState("");
  const [selected, setSelected] = useState<SelectedMedia | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileGuesses, setFileGuesses] = useState<FileGuess[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [fileOps, setFileOps] = useState<RenameOp[]>([]);
  const [folderOps, setFolderOps] = useState<RenameOp[]>([]);
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

  async function loadFiles(path: string) {
    if (!path.trim()) return;
    setLoadingFiles(true);
    setError("");
    try {
      const res = await api.identifyFiles(path.trim());
      setFiles(res.files);
      setFileGuesses(res.file_guesses);
      if (res.guess.title) {
        setMediaType(res.guess.type);
        setGuessQuery(res.guess.title);
        setSearchOpen(true);
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
      type: mediaType,
      number_of_seasons: result.number_of_seasons,
      poster_path: result.poster_path,
    };
    setSelected(next);
    setSearchOpen(false);
    setEpisodes([]);
    setAssignments({});

    if (mediaType === "movie") {
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

  function changeMediaType(t: MediaType) {
    setMediaType(t);
    setSelected(null);
    setEpisodes([]);
    setAssignments({});
  }

  async function openPreview() {
    if (!selected) return;
    setPreviewOpen(true);
    setApplyResult(null);
    setPreviewError("");
    setLoadingPreview(true);
    try {
      const fileToSlot = new Map<string, string>();
      for (const [key, fp] of Object.entries(assignments)) fileToSlot.set(fp, key);
      const mappings: FileMapping[] = files.map((fp) => {
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
      const res = await api.identifyPreview({
        folder_path: folderPath.trim(),
        type: mediaType,
        title: selected.title,
        year: selected.year,
        tmdb_id: selected.tmdb_id,
        mappings,
        target_dir: targetDir.trim() || null,
      });
      setFileOps(res.file_ops);
      setFolderOps(res.folder_ops);
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
      const res = await api.identifyApply({ file_ops: fileOps, folder_ops: folderOps });
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
    setFileOps([]);
    setFolderOps([]);
    setApplyResult(null);
    setPreviewOpen(false);
    setSearchOpen(false);
    setError("");
    setPreviewError("");
  }

  const boardReady = selected !== null && episodes.length > 0;
  const matched = Object.keys(assignments).length;

  return (
    <div className="flex min-h-full flex-col p-4 md:p-6">
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
          Requires a TMDB API key — configure in Settings → Keys &amp; Accounts
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
          mediaType={mediaType}
          onMediaTypeChange={changeMediaType}
          selected={selected}
          loadingEpisodes={loadingEpisodes}
          episodeCount={episodes.length}
          onOpenSearch={() => setSearchOpen(true)}
        />

        {boardReady ? (
          <MatchBoard
            key={selected!.tmdb_id}
            files={files}
            episodes={episodes}
            mediaType={mediaType}
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
                  {folderPath
                    ? `${files.length} file${files.length === 1 ? "" : "s"} loaded — find the ${
                        mediaType === "tv" ? "show" : "movie"
                      } to match them against.`
                    : "Pick a source folder to begin."}
                </p>
                {folderPath && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search className="h-4 w-4" />
                    Search TMDB
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {boardReady && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border bg-[var(--px-bg-base)]/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium text-foreground">
              {matched}/{episodes.length}
            </span>{" "}
            matched
          </p>
          <Button type="button" onClick={openPreview} className="gap-2">
            Preview renames
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <MediaSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        mediaType={mediaType}
        onMediaTypeChange={setMediaType}
        initialQuery={guessQuery}
        selectedId={selected?.tmdb_id ?? null}
        onPick={selectMedia}
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
