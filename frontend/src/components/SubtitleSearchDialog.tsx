import { useState, useEffect, useRef } from "react";
import { Loader2, Download, CheckCircle2, Search, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { api, subtitlesApi } from "@/lib/api";
import type { SearchResult } from "@/types/identify";
import type { SubtitleCandidate, SubtitleFile } from "@/types/subtitle";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  nb: "Norwegian",
  tr: "Turkish",
};

// subf2m only exposes a coarse good/bad/not-rated widget (mapped to a
// 20/50/80 score server-side); yts-subs has a real 0-5 star rating scaled to
// 0-100. Neither site publishes an actual download count.
function MatchPct({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score));
  return (
    <span
      className={cn(
        "text-[11px] font-medium tabular-nums shrink-0 w-9 text-right",
        pct >= 70 ? "text-green-500" : pct >= 40 ? "text-amber-500" : "text-muted-foreground/60",
      )}
    >
      {pct}%
    </span>
  );
}

interface Props {
  file: SubtitleFile;
  languages: string[];
  onClose: () => void;
  onDownloaded: () => void;
}

export function SubtitleSearchDialog({ file, languages, onClose, onDownloaded }: Props) {
  const [query, setQuery] = useState(file.title || file.filename.replace(/\.[^.]+$/, ""));
  const [yearOverride, setYearOverride] = useState<number | undefined>(undefined);
  const [manualYear, setManualYear] = useState(file.year ? String(file.year) : "");
  const [mediaType, setMediaType] = useState<"movie" | "tv">(
    file.media_type === "episode" ? "tv" : "movie",
  );
  const [seasonInput, setSeasonInput] = useState(file.season != null ? String(file.season) : "1");
  const [episodeInput, setEpisodeInput] = useState(
    file.episode != null ? String(file.episode) : "1",
  );
  const [dialogLangs, setDialogLangs] = useState<string[]>(languages);
  const [tmdbAvailable, setTmdbAvailable] = useState<boolean | null>(null);
  const [searchProvider, setSearchProvider] = useState<"subf2m" | "ytssubs">("subf2m");

  const toggleLang = (code: string) => {
    setDialogLangs((prev) =>
      prev.includes(code)
        ? prev.length > 1
          ? prev.filter((c) => c !== code)
          : prev // keep at least one
        : [...prev, code],
    );
  };

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setTmdbAvailable(!!s.tmdb_api_key?.trim()))
      .catch(() => setTmdbAvailable(false));
  }, []);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [tmdbResults, setTmdbResults] = useState<SearchResult[]>([]);
  const [tmdbError, setTmdbError] = useState("");
  const skipNextTmdbSearch = useRef(false);

  useEffect(() => {
    if (tmdbAvailable !== true) return;
    if (skipNextTmdbSearch.current) {
      skipNextTmdbSearch.current = false;
      return;
    }
    if (!query.trim()) {
      // Clear results when search query is empty
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTmdbResults([]);
      return;
    }
    const t = setTimeout(() => {
      setTmdbSearching(true);
      setTmdbError("");
      api
        .identifySearch({ query: query.trim(), type: mediaType })
        .then(setTmdbResults)
        .catch((e: unknown) => setTmdbError(e instanceof Error ? e.message : "TMDB search failed"))
        .finally(() => setTmdbSearching(false));
    }, 500);
    return () => clearTimeout(t);
  }, [query, mediaType, tmdbAvailable]);

  const runSearch = () => {
    const title = query.trim();
    if (!title) return;
    if (searchProvider === "ytssubs" && !tmdbAvailable) return;
    const manualYearNum = manualYear.trim() ? parseInt(manualYear, 10) : undefined;
    setSearching(true);
    setError("");
    subtitlesApi
      .searchFile(file.path, dialogLangs, {
        query: title,
        year: yearOverride ?? manualYearNum,
        media_type: mediaType,
        season: mediaType === "tv" ? parseInt(seasonInput, 10) || 1 : undefined,
        episode: mediaType === "tv" ? parseInt(episodeInput, 10) || 1 : undefined,
        provider: searchProvider,
      })
      .then(setCandidates)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => {
        setSearching(false);
        setSearched(true);
      });
  };

  const pickTmdbResult = (r: SearchResult) => {
    skipNextTmdbSearch.current = true;
    setQuery(r.title);
    setYearOverride(r.year ?? undefined);
    setTmdbResults([]);
  };

  const handleDownload = async (c: SubtitleCandidate) => {
    const key = `${c.provider}:${c.subtitle_id}`;
    setDownloadingId(key);
    try {
      await subtitlesApi.downloadOne(file.path, c.provider, c.subtitle_id, c.language);
      setDownloaded((prev) => new Set(prev).add(key));
      onDownloaded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col" onClose={onClose}>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm truncate pr-6">{file.filename}</DialogTitle>
          {searched && (
            <p className="text-xs text-muted-foreground">
              {searching
                ? "Searching…"
                : `${candidates.length} subtitle${candidates.length !== 1 ? "s" : ""} found`}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 shrink-0">
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Search
            </span>
            <div className="flex gap-2">
              <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                {(["movie", "tv"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMediaType(t)}
                    className={cn(
                      "px-2.5 text-xs font-medium capitalize transition-colors",
                      mediaType === t
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Input
                autoFocus
                placeholder="Title…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setYearOverride(undefined);
                }}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                className="text-sm flex-1"
              />
              {tmdbAvailable === false && (
                <Input
                  placeholder="Year"
                  inputMode="numeric"
                  value={manualYear}
                  onChange={(e) => setManualYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  className="text-sm w-20 shrink-0"
                />
              )}
              <Button
                onClick={() => runSearch()}
                disabled={
                  searching ||
                  !query.trim() ||
                  (searchProvider === "ytssubs" && tmdbAvailable === false)
                }
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            {tmdbAvailable === false && (
              <p className="text-xs text-muted-foreground">
                No TMDB key configured — enter title and year yourself. Add a key in Settings → Keys
                &amp; Accounts for TMDB-assisted search.
              </p>
            )}
            {yearOverride != null && (
              <p className="text-xs text-muted-foreground">
                Using TMDB match: {query} ({yearOverride})
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Source
            </span>
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              {[
                { id: "subf2m" as const, label: "Subf2m" },
                { id: "ytssubs" as const, label: "YTS-Subs" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSearchProvider(id);
                    setSearched(false);
                    setCandidates([]);
                  }}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium transition-colors",
                    searchProvider === id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {searchProvider === "ytssubs" && tmdbAvailable === false && (
              <Link
                to="/settings?tab=credentials"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="h-3 w-3" />
                YTS-Subs needs a TMDB API key to look up the film — configure in Settings → Keys
                &amp; Accounts
              </Link>
            )}
          </div>

          {mediaType === "tv" && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Episode
                </span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Season</span>
                  <Input
                    inputMode="numeric"
                    value={seasonInput}
                    onChange={(e) => setSeasonInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    className="text-sm w-14 h-7"
                  />
                  <span>Episode</span>
                  <Input
                    inputMode="numeric"
                    value={episodeInput}
                    onChange={(e) => setEpisodeInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    className="text-sm w-14 h-7"
                  />
                  {(file.season != null || file.episode != null) && (
                    <span className="text-muted-foreground/60">
                      (guessed from filename — correct if wrong)
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Languages
            </span>
            <div className="flex flex-wrap gap-2">
              {COMMON_LANGS.map(({ code, label }) => {
                const active = dialogLangs.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleLang(code)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground/70">
              Fewer languages = faster search — subf2m is queried once per language selected.
            </p>
          </div>
        </div>

        {tmdbAvailable === true &&
          query.trim() &&
          yearOverride == null &&
          (tmdbSearching || tmdbResults.length > 0 || tmdbError) && (
            <div className="mt-3 border border-border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
                TMDB matches — pick one to set exact title/year
              </span>
              {tmdbSearching && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {tmdbError && <p className="text-xs text-destructive px-1">{tmdbError}</p>}
              {!tmdbSearching && !tmdbError && tmdbResults.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No TMDB matches.</p>
              )}
              {!tmdbSearching &&
                tmdbResults.map((r) => (
                  <button
                    key={r.tmdb_id}
                    type="button"
                    onClick={() => pickTmdbResult(r)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="w-6 h-9 rounded-sm bg-muted shrink-0 overflow-hidden">
                      {r.poster_path && (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${r.poster_path}`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <span className="truncate">{r.title}</span>
                    {r.year && (
                      <span className="text-xs text-muted-foreground shrink-0">({r.year})</span>
                    )}
                  </button>
                ))}
            </div>
          )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {searched && !searching && candidates.length === 0 && !error && (
          <p className="mt-3 text-sm text-muted-foreground py-8 text-center">
            No subtitles found — try a different title.
          </p>
        )}

        {candidates.length > 0 && (
          <div className="mt-3 overflow-y-auto flex-1 -mx-6 px-6 space-y-1">
            {candidates.map((c) => {
              const key = `${c.provider}:${c.subtitle_id}`;
              const isDone = downloaded.has(key);
              const isLoading = downloadingId === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                    isDone
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border hover:bg-muted/30",
                  )}
                >
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-primary/15 text-primary">
                    {c.provider.slice(0, 4).toUpperCase()}
                  </span>

                  <span className="text-xs font-medium shrink-0 w-8 text-muted-foreground">
                    {LANG_NAMES[c.language] ? c.language.toUpperCase() : c.language}
                  </span>

                  <span className="flex-1 text-xs text-muted-foreground truncate" title={c.release}>
                    {c.release}
                  </span>

                  <MatchPct score={c.score} />

                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 shrink-0"
                      disabled={!!downloadingId}
                      onClick={() => handleDownload(c)}
                      title="Download this subtitle"
                    >
                      {isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
