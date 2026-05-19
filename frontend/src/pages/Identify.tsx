import { useState, useRef } from "react";
import { Loader2, Search, ChevronRight, Check, AlertCircle, Wand2, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { FileMatcher } from "@/components/FileMatcher";
import { DirPicker } from "@/components/DirPicker";
import { api, type SearchResult, type Episode, type RenameOp, type FileMapping } from "@/lib/api";

type Step = "search" | "match" | "preview" | "done";
type MediaType = "movie" | "tv";

interface SelectedMedia {
  tmdb_id: number;
  title: string;
  year: number | null;
  type: MediaType;
}

export function Identify() {
  const [step, setStep]                       = useState<Step>("search");
  const [folderPath, setFolderPath]           = useState("");
  const [mediaType, setMediaType]             = useState<MediaType>("tv");
  const [searchQuery, setSearchQuery]         = useState("");
  const [searchResults, setSearchResults]     = useState<SearchResult[]>([]);
  const [selected, setSelected]               = useState<SelectedMedia | null>(null);
  const [seasonNumber, setSeasonNumber]       = useState(1);
  const [episodes, setEpisodes]               = useState<Episode[]>([]);
  const [files, setFiles]                     = useState<string[]>([]);
  const [orderedFiles, setOrderedFiles]       = useState<string[]>([]);
  const [fileOps, setFileOps]                 = useState<RenameOp[]>([]);
  const [folderOps, setFolderOps]             = useState<RenameOp[]>([]);
  const [applySuccesses, setApplySuccesses]   = useState<string[]>([]);
  const [applyFailures, setApplyFailures]     = useState<{ path: string; error: string }[]>([]);
  const [picking, setPicking]                 = useState(false);
  const [loadingFiles, setLoadingFiles]       = useState(false);
  const [loadingSearch, setLoadingSearch]     = useState(false);
  const [loadingSeason, setLoadingSeason]     = useState(false);
  const [loadingPreview, setLoadingPreview]   = useState(false);
  const [loadingApply, setLoadingApply]       = useState(false);
  const [error, setError]                     = useState("");

  async function loadFiles() {
    if (!folderPath.trim()) return;
    setLoadingFiles(true);
    setError("");
    try {
      const res = await api.identifyFiles(folderPath.trim());
      setFiles(res.files);
      setOrderedFiles(res.files);
    } catch (e: any) {
      setError(e.message || "Failed to load files");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setLoadingSearch(true);
    setError("");
    setSelected(null);
    setEpisodes([]);
    try {
      const results = await api.identifySearch({ query: searchQuery.trim(), type: mediaType });
      setSearchResults(results);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  }

  const seasonDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchSeason(tmdbId: number, season: number) {
    setLoadingSeason(true);
    setError("");
    try {
      const eps = await api.identifyGetSeason(tmdbId, season);
      setEpisodes(eps);
    } catch (e: any) {
      setError(e.message || "Failed to load season");
    } finally {
      setLoadingSeason(false);
    }
  }

  async function selectMedia(result: SearchResult) {
    const media = { tmdb_id: result.tmdb_id, title: result.title, year: result.year, type: mediaType };
    setSelected(media);
    setEpisodes([]);
    if (mediaType === "movie") {
      setEpisodes([{ episode_number: 1, name: result.title, overview: result.overview }]);
    } else {
      setSeasonNumber(1);
      fetchSeason(result.tmdb_id, 1);
    }
  }

  function handleSeasonChange(n: number) {
    const season = Math.max(1, n);
    setSeasonNumber(season);
    if (!selected) return;
    if (seasonDebounce.current) clearTimeout(seasonDebounce.current);
    seasonDebounce.current = setTimeout(() => fetchSeason(selected.tmdb_id, season), 400);
  }

  function canAdvanceToMatch() {
    return files.length > 0 && selected !== null && episodes.length > 0;
  }

  async function doPreview() {
    if (!selected) return;
    setLoadingPreview(true);
    setError("");
    try {
      const mappings: FileMapping[] = orderedFiles.map((fp, i) => ({
        file_path: fp,
        episode_number: episodes[i]?.episode_number ?? null,
        episode_name: episodes[i]?.name ?? null,
      }));
      const res = await api.identifyPreview({
        folder_path: folderPath.trim(),
        type: mediaType,
        title: selected.title,
        year: selected.year,
        tmdb_id: selected.tmdb_id,
        season_number: mediaType === "tv" ? seasonNumber : null,
        mappings,
      });
      setFileOps(res.file_ops);
      setFolderOps(res.folder_ops);
      setStep("preview");
    } catch (e: any) {
      setError(e.message || "Preview failed");
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
    } catch (e: any) {
      setError(e.message || "Apply failed");
    } finally {
      setLoadingApply(false);
    }
  }

  function handleFolderSelect(path: string) {
    setFolderPath(path);
    setPicking(false);
    setFiles([]);
    setOrderedFiles([]);
  }

  function reset() {
    setStep("search");
    setFolderPath("");
    setSearchQuery("");
    setSearchResults([]);
    setSelected(null);
    setEpisodes([]);
    setFiles([]);
    setOrderedFiles([]);
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
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <SectionHeader className="mb-1.5">Media management</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Identify & Rename</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Identify a folder of badly-named files and rename them to Plex/Jellyfin format.
        </p>
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
                <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)} className="gap-1.5 shrink-0">
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
                {folderPath && (
                  <Button onClick={loadFiles} disabled={loadingFiles} size="sm">
                    {loadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load files"}
                  </Button>
                )}
              </div>
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Found <span className="text-foreground font-medium">{files.length}</span> video file(s).
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
                      onClick={() => { setMediaType(t); setSelected(null); setSearchResults([]); setEpisodes([]); }}
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
                <Button onClick={doSearch} disabled={loadingSearch || !searchQuery.trim()} size="sm">
                  {loadingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
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
                          isActive ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
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
                          <p className="text-xs font-medium leading-tight line-clamp-2">{r.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.year ?? "—"}
                            {r.number_of_seasons != null && (
                              <span className="ml-1">· {r.number_of_seasons} season{r.number_of_seasons !== 1 ? "s" : ""}</span>
                            )}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selected && mediaType === "tv" && (
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-sm text-muted-foreground whitespace-nowrap">Season</label>
                  <input
                    type="number"
                    min={1}
                    value={seasonNumber}
                    onChange={(e) => handleSeasonChange(Number(e.target.value))}
                    className="w-20 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {loadingSeason
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : episodes.length > 0 && (
                        <span className="text-xs text-muted-foreground">{episodes.length} episodes</span>
                      )
                  }
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
                Drag files to reorder them so they line up with the correct{" "}
                {mediaType === "tv" ? "episode" : "title"} on the right.
                Files without a match will not be renamed.
              </p>
              <FileMatcher
                files={orderedFiles}
                episodes={episodes}
                season={seasonNumber}
                mediaType={mediaType}
                onChange={setOrderedFiles}
              />
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("search")}>Back</Button>
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
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Folder</p>
                  {folderOps.map((op) => (
                    <div key={op.old_path} className="text-xs font-mono bg-muted/30 rounded px-3 py-2 space-y-0.5">
                      <p className="text-muted-foreground line-through truncate">{op.old_path}</p>
                      <p className="text-primary truncate">{op.new_path}</p>
                    </div>
                  ))}
                </div>
              )}

              {fileOps.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Files</p>
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
                <p className="text-sm text-muted-foreground">Everything is already correctly named.</p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("match")}>Back</Button>
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
                  <span className="text-foreground font-medium">{applySuccesses.length}</span> item(s).
                </p>
              )}
              {applyFailures.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">
                    {applyFailures.length} failure(s):
                  </p>
                  {applyFailures.map((f) => (
                    <div key={f.path} className="text-xs font-mono bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
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
