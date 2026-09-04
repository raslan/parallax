import { useState } from "react";
import {
  Loader2,
  Search,
  ChevronRight,
  Check,
  AlertCircle,
  Wand2,
  FolderOpen,
  Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { FileMatcher } from "@/components/FileMatcher";
import { DirPicker } from "@/components/DirPicker";
import { api } from "@/lib/api";
import type { SearchResult, Episode, RenameOp, FileMapping } from "@/types/identify";
import {
  type FileGuess,
  distinctSeasons,
  buildInitialAssignments,
  poolFiles,
  slotKey,
} from "@/lib/episodeMatching";
import { Link } from "react-router-dom";

type Step = "search" | "match" | "preview" | "done";
type MediaType = "movie" | "tv";

interface SelectedMedia {
  tmdb_id: number;
  title: string;
  year: number | null;
  type: MediaType;
  number_of_seasons: number | null;
}

export function Identify() {
  const [step, setStep] = useState<Step>("search");
  const [folderPath, setFolderPath] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("tv");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SelectedMedia | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileGuesses, setFileGuesses] = useState<FileGuess[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loadedSeasons, setLoadedSeasons] = useState<number[]>([]);
  const [addSeasonInput, setAddSeasonInput] = useState("");
  const [fileOps, setFileOps] = useState<RenameOp[]>([]);
  const [folderOps, setFolderOps] = useState<RenameOp[]>([]);
  const [applySuccesses, setApplySuccesses] = useState<string[]>([]);
  const [applyFailures, setApplyFailures] = useState<{ path: string; error: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [loadingAddSeason, setLoadingAddSeason] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [error, setError] = useState("");

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
        setSearchQuery(res.guess.title);
        doSearch(res.guess.title, res.guess.type);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Failed to load files");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function doSearch(queryArg?: string, typeArg?: MediaType) {
    const query = (queryArg ?? searchQuery).trim();
    const type = typeArg ?? mediaType;
    if (!query) return;
    setLoadingSearch(true);
    setError("");
    setSelected(null);
    setEpisodes([]);
    try {
      const results = await api.identifySearch({ query, type });
      setSearchResults(results);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  }

  async function selectMedia(result: SearchResult) {
    setSelected({
      tmdb_id: result.tmdb_id,
      title: result.title,
      year: result.year,
      type: mediaType,
      number_of_seasons: result.number_of_seasons,
    });
    setEpisodes([]);
    setAssignments({});
    setLoadedSeasons([]);
    if (mediaType === "movie") {
      const movieEpisode: Episode = {
        season_number: 1,
        episode_number: 1,
        name: result.title,
        overview: result.overview,
      };
      setEpisodes([movieEpisode]);
      if (files.length > 0) {
        setAssignments({ [slotKey(1, 1)]: files[0]! });
      }
    } else {
      setLoadingEpisodes(true);
      setError("");
      try {
        const detected = distinctSeasons(fileGuesses);
        const seasonsToLoad = detected.length > 0 ? detected : [1];
        const seasonResults = await Promise.allSettled(
          seasonsToLoad.map((sn) => api.identifyGetSeason(result.tmdb_id, sn)),
        );
        const eps: Episode[] = [];
        const successfulSeasons: number[] = [];
        seasonResults.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            eps.push(...res.value);
            successfulSeasons.push(seasonsToLoad[idx]!);
          }
        });
        if (successfulSeasons.length === 0) {
          throw new Error("Failed to load episodes");
        }
        eps.sort((a, b) =>
          a.season_number !== b.season_number
            ? a.season_number - b.season_number
            : a.episode_number - b.episode_number,
        );
        setEpisodes(eps);
        setLoadedSeasons(successfulSeasons);
        const slotKeys = new Set(eps.map((e) => slotKey(e.season_number, e.episode_number)));
        setAssignments(buildInitialAssignments(files, fileGuesses, slotKeys));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        setError(msg || "Failed to load episodes");
      } finally {
        setLoadingEpisodes(false);
      }
    }
  }

  async function addSeason() {
    const sn = parseInt(addSeasonInput, 10);
    if (!selected || !Number.isFinite(sn) || sn < 1) return;
    if (loadedSeasons.includes(sn)) {
      setAddSeasonInput("");
      return;
    }
    if (selected.number_of_seasons != null && sn > selected.number_of_seasons) {
      setError(`This show only has ${selected.number_of_seasons} season(s).`);
      return;
    }
    setLoadingAddSeason(true);
    setError("");
    try {
      const newEps = await api.identifyGetSeason(selected.tmdb_id, sn);
      setEpisodes((prev) =>
        [...prev, ...newEps].sort((a, b) =>
          a.season_number !== b.season_number
            ? a.season_number - b.season_number
            : a.episode_number - b.episode_number,
        ),
      );
      setLoadedSeasons((prev) => [...prev, sn].sort((a, b) => a - b));
      const newSlotKeys = new Set(newEps.map((e) => slotKey(e.season_number, e.episode_number)));
      const stillPooled = poolFiles(files, assignments);
      const additions = buildInitialAssignments(stillPooled, fileGuesses, newSlotKeys);
      setAssignments((prev) => ({ ...prev, ...additions }));
      setAddSeasonInput("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Failed to load season");
    } finally {
      setLoadingAddSeason(false);
    }
  }

  function canAdvanceToMatch() {
    return files.length > 0 && selected !== null && episodes.length > 0 && !loadingEpisodes;
  }

  async function doPreview() {
    if (!selected) return;
    setLoadingPreview(true);
    setError("");
    try {
      const fileToSlot = new Map<string, string>();
      for (const [key, fp] of Object.entries(assignments)) {
        fileToSlot.set(fp, key);
      }
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
      });
      setFileOps(res.file_ops);
      setFolderOps(res.folder_ops);
      setStep("preview");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doApply() {
    setLoadingApply(true);
    setError("");
    try {
      const res = await api.identifyApply({ file_ops: fileOps, folder_ops: folderOps });
      setApplySuccesses(res.successes);
      setApplyFailures(res.failures);
      setStep("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Apply failed");
    } finally {
      setLoadingApply(false);
    }
  }

  function handleFolderSelect(path: string) {
    setFolderPath(path);
    setPicking(false);
    setFiles([]);
    setFileGuesses([]);
    setError("");
    loadFiles(path);
  }

  function reset() {
    setStep("search");
    setFolderPath("");
    setSearchQuery("");
    setSearchResults([]);
    setSelected(null);
    setEpisodes([]);
    setFiles([]);
    setFileGuesses([]);
    setAssignments({});
    setLoadedSeasons([]);
    setAddSeasonInput("");
    setFileOps([]);
    setFolderOps([]);
    setApplySuccesses([]);
    setApplyFailures([]);
    setError("");
  }

  const stepLabels: Record<Step, string> = {
    search: "1. Search",
    match: "2. Match files",
    preview: "3. Preview",
    done: "Done",
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl">
      <div>
        <SectionHeader className="mb-1.5">Media management</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Identify & Rename</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Identify a folder of badly-named files and rename them to Plex/Jellyfin format.
        </p>
        <Link
          to="/settings?tab=credentials"
          className="inline-flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="h-3 w-3" />
          Requires a TMDB API key — configure in Settings → Keys &amp; Accounts
        </Link>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {(["search", "match", "preview", "done"] as Step[]).map((s, i, arr) => (
          <span key={s} className="flex items-center gap-2">
            <span className={step === s ? "text-primary font-medium" : ""}>{stepLabels[s]}</span>
            {i < arr.length - 1 && <ChevronRight className="h-3 w-3" />}
          </span>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/10">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Step 1: Search ── */}
      {step === "search" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Folder</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-mono text-muted-foreground truncate">
                  {folderPath || <span className="italic">No folder selected</span>}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPicking(true)}
                  className="gap-1.5 shrink-0"
                >
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
                {loadingFiles && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                )}
              </div>
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Found <span className="text-foreground font-medium">{files.length}</span> video
                  file(s).
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Search TMDB</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex border border-border rounded-md overflow-hidden text-xs">
                  {(["tv", "movie"] as MediaType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setMediaType(t);
                        setSelected(null);
                        setSearchResults([]);
                        setEpisodes([]);
                      }}
                      className={`px-3 py-2 transition-colors ${
                        mediaType === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                      }`}
                    >
                      {t === "tv" ? "TV Show" : "Movie"}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  placeholder="Breaking Bad…"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button
                  onClick={() => doSearch()}
                  disabled={loadingSearch || !searchQuery.trim()}
                  size="sm"
                >
                  {loadingSearch ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {searchResults.map((r) => {
                    const isActive = selected?.tmdb_id === r.tmdb_id;
                    return (
                      <button
                        key={r.tmdb_id}
                        onClick={() => selectMedia(r)}
                        className={`group flex flex-col rounded-md border overflow-hidden text-left transition-colors ${
                          isActive
                            ? "border-primary ring-1 ring-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="aspect-[2/3] bg-muted relative overflow-hidden">
                          {r.poster_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w200${r.poster_path}`}
                              alt={r.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                              No image
                            </div>
                          )}
                          {isActive && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <Check className="h-6 w-6 text-primary drop-shadow" />
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-0.5">
                          <p className="text-xs font-medium leading-tight line-clamp-2">
                            {r.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.year ?? "—"}
                            {r.number_of_seasons != null && (
                              <span className="ml-1">
                                · {r.number_of_seasons} season{r.number_of_seasons !== 1 ? "s" : ""}
                              </span>
                            )}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selected && mediaType === "tv" && (
                <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  {loadingEpisodes ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading episodes…
                    </>
                  ) : (
                    episodes.length > 0 && (
                      <span>
                        {episodes.length} episodes across{" "}
                        {new Set(episodes.map((e) => e.season_number)).size} season(s) loaded
                      </span>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            onClick={() => setStep("match")}
            disabled={!canAdvanceToMatch()}
            className="gap-2"
          >
            Next: Match files
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Step 2: Match ── */}
      {step === "match" && selected && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Match files to {mediaType === "tv" ? "episodes" : "movie"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {mediaType === "tv"
                  ? "Drag a file onto the episode it belongs to. Empty slots and unplaced files are skipped when renaming."
                  : "Drag a file onto the movie slot to rename it."}
              </p>
              <FileMatcher
                files={files}
                episodes={episodes}
                mediaType={mediaType}
                assignments={assignments}
                onAssignmentsChange={setAssignments}
              />
              {mediaType === "tv" && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number"
                    min={1}
                    max={selected.number_of_seasons ?? undefined}
                    value={addSeasonInput}
                    onChange={(e) => setAddSeasonInput(e.target.value)}
                    placeholder="Season #"
                    className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSeason}
                    disabled={loadingAddSeason || !addSeasonInput.trim()}
                  >
                    {loadingAddSeason ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Add season"
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Loaded: {loadedSeasons.length > 0 ? loadedSeasons.join(", ") : "none"}
                    {selected.number_of_seasons != null &&
                      ` of ${selected.number_of_seasons} season(s)`}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("search")}>
              Back
            </Button>
            <Button onClick={doPreview} disabled={loadingPreview} className="gap-2">
              {loadingPreview && <Loader2 className="h-4 w-4 animate-spin" />}
              Next: Preview renames
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview ── */}
      {step === "preview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview renames</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {folderOps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Folder
                  </p>
                  {folderOps.map((op) => (
                    <div
                      key={op.old_path}
                      className="text-xs font-mono bg-muted/30 rounded px-3 py-2 space-y-0.5"
                    >
                      <p className="text-muted-foreground line-through truncate">{op.old_path}</p>
                      <p className="text-primary truncate">{op.new_path}</p>
                    </div>
                  ))}
                </div>
              )}

              {fileOps.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Files
                  </p>
                  <div className="rounded-md border border-border overflow-hidden">
                    {fileOps.map((op) => (
                      <div
                        key={op.old_path}
                        className="px-3 py-2 border-b border-border last:border-0 text-xs font-mono space-y-0.5"
                      >
                        <p className="text-muted-foreground line-through truncate">
                          {op.old_path.split("/").pop()}
                        </p>
                        <p className="text-primary truncate">{op.new_path.split("/").pop()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No file renames needed.</p>
              )}

              {fileOps.length === 0 && folderOps.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Everything is already correctly named.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("match")}>
              Back
            </Button>
            <Button
              onClick={doApply}
              disabled={loadingApply || (fileOps.length === 0 && folderOps.length === 0)}
              className="gap-2"
            >
              {loadingApply && <Loader2 className="h-4 w-4 animate-spin" />}
              <Wand2 className="h-4 w-4" />
              Apply renames
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === "done" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Check className="h-4 w-4 text-green-400" />
                Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {applySuccesses.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Successfully renamed{" "}
                  <span className="text-foreground font-medium">{applySuccesses.length}</span>{" "}
                  item(s).
                </p>
              )}
              {applyFailures.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">
                    {applyFailures.length} failure(s):
                  </p>
                  {applyFailures.map((f) => (
                    <div
                      key={f.path}
                      className="text-xs font-mono bg-destructive/10 border border-destructive/30 rounded px-3 py-2"
                    >
                      <p className="text-muted-foreground truncate">{f.path}</p>
                      <p className="text-destructive">{f.error}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Button onClick={reset}>Identify another folder</Button>
        </div>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select folder</DialogTitle>
          </DialogHeader>
          <DirPicker onSelect={handleFolderSelect} onClose={() => setPicking(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
