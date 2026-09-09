import { useEffect, useState } from "react";
import { Loader2, Search, Check, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { SearchResult } from "@/types/identify";

type MediaType = "movie" | "tv";

interface MediaSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaType: MediaType;
  onMediaTypeChange: (t: MediaType) => void;
  initialQuery: string;
  selectedId: number | null;
  onPick: (result: SearchResult) => void;
  onUseCustom: () => void;
}

export function MediaSearchDialog({
  open,
  onOpenChange,
  mediaType,
  onMediaTypeChange,
  initialQuery,
  selectedId,
  onPick,
  onUseCustom,
}: MediaSearchDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchedFor, setSearchedFor] = useState("");

  // Reseed the box — and auto-run the search — when the page hands in a fresh
  // guess (a new source folder was picked). Manual opens don't touch initialQuery
  // so they stay quiet until the user hits search.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(initialQuery);
    setResults([]);
    setSearchedFor("");
    if (!initialQuery.trim()) return;
    const id = setTimeout(() => doSearch(initialQuery, mediaType), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  async function doSearch(q: string, type: MediaType) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setSearchedFor(trimmed);
    try {
      setResults(await api.identifySearch({ query: trimmed, type }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find the {mediaType === "tv" ? "show" : "movie"} on TMDB</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            {(["tv", "movie"] as MediaType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  onMediaTypeChange(t);
                  setResults([]);
                  setSearchedFor("");
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
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query, mediaType)}
            placeholder="Breaking Bad…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => doSearch(query, mediaType)}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-4 max-h-[60vh] overflow-y-auto">
          {results.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {results.map((r) => {
                const isActive = selectedId === r.tmdb_id;
                return (
                  <button
                    key={r.tmdb_id}
                    type="button"
                    onClick={() => onPick(r)}
                    className={`group flex flex-col overflow-hidden rounded-md border text-left transition-colors ${
                      isActive
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="relative aspect-[2/3] overflow-hidden bg-muted">
                      {r.poster_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w200${r.poster_path}`}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          No image
                        </div>
                      )}
                      {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                          <Check className="h-6 w-6 text-primary drop-shadow" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-xs font-medium leading-tight">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.year ?? "—"}
                        {r.number_of_seasons != null && (
                          <span className="ml-1">
                            · {r.number_of_seasons} season{r.number_of_seasons === 1 ? "" : "s"}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            !loading &&
            searchedFor && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing found for “{searchedFor}”. Try a different spelling or media type
                  {" — "}or{" "}
                  <button
                    type="button"
                    onClick={onUseCustom}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    build it as a custom show
                  </button>
                  .
                </p>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
