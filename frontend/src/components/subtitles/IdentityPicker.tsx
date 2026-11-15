import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Clapperboard, Loader2, Search } from "lucide-react";
import { qk, subtitlesApi } from "@/lib/api";
import { errorDetail, getErrorMessage } from "@/lib/api/client";
import { MediaSearchDialog } from "@/components/identify/MediaSearchDialog";
import { RadioToggle } from "@/components/RadioToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Identity } from "@/types/subtitle";

type MediaType = "movie" | "tv";

const TYPE_OPTIONS: { id: MediaType; label: string }[] = [
  { id: "movie", label: "Film" },
  { id: "tv", label: "Show" },
];

/** A four-digit year in the range the server takes, else null. */
function parseYear(text: string): number | null {
  const t = text.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1870 && n <= 2200 ? n : null;
}

/** A readable title from a subtitle-site page path (`/subtitles/the-office-us` → `the office us`). */
function titleFromPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  return slug
    .replace(/-(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)-season$/, "")
    .replace(/-/g, " ");
}

const fieldClass = "h-8 text-sm";

/**
 * Says which show or film a title group is, by hand first: YTS film cards (films only),
 * a typed title and year (Subf2m, the only source for TV), a pasted IMDB id or link or a
 * Subf2m page link, and TMDB as an optional upgrade when a key is set (poster search with
 * the year). The picked identity keeps its year and ids so the search cannot drop them.
 * Searching here is read-only. Props-in/callbacks-out; like Identify's TMDB dialog it runs
 * its own title search.
 */
export function IdentityPicker({
  initial,
  onPick,
  hasTmdbKey,
  type,
}: {
  initial: Identity | null;
  onPick: (identity: Identity) => void;
  hasTmdbKey: boolean;
  /** The group's type; YTS has films only, so it is greyed for a show. */
  type: MediaType | null;
}) {
  const films = type !== "tv";
  const [tab, setTab] = useState(films ? "yts" : "subf2m");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [mediaType, setMediaType] = useState<MediaType>(type ?? initial?.type ?? "movie");
  const [ytsDraft, setYtsDraft] = useState(initial?.title ?? "");
  const [ytsQuery, setYtsQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [tmdbOpen, setTmdbOpen] = useState(false);

  const ytsQ = useQuery({
    queryKey: qk.subtitleYts(ytsQuery),
    queryFn: () => subtitlesApi.yts(ytsQuery),
    enabled: ytsQuery !== "",
  });

  const pasted = useMutation({
    mutationFn: (text: string) => subtitlesApi.parsePasted(text),
    meta: { skipErrorToast: true },
    onSuccess: (p) => {
      const base: Identity = { title: title.trim(), year: parseYear(year), type: mediaType };
      if (p.imdb_id) onPick({ ...base, title: base.title || p.imdb_id, imdb_id: p.imdb_id });
      else if (p.subf2m_path)
        // The exact page is searched; the title is only what it is called here (editable).
        onPick({
          ...base,
          title: base.title || titleFromPath(p.subf2m_path),
          subf2m_path: p.subf2m_path,
        });
    },
  });

  const typed = title.trim();

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="yts" disabled={!films}>
            YTS
            {!films && <span className="ml-1.5 text-3xs text-muted-foreground">Films only</span>}
          </TabsTrigger>
          <TabsTrigger value="subf2m">Subf2m</TabsTrigger>
          <TabsTrigger value="paste">Paste a link</TabsTrigger>
          {hasTmdbKey && <TabsTrigger value="tmdb">TMDB</TabsTrigger>}
        </TabsList>

        <TabsContent value="yts" className="space-y-3 pt-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setYtsQuery(ytsDraft.trim());
            }}
          >
            <Input
              value={ytsDraft}
              onChange={(e) => setYtsDraft(e.target.value)}
              aria-label="Film title"
              placeholder="Film title"
              className={fieldClass}
            />
            <Button type="submit" size="sm" aria-label="Search YTS" disabled={!ytsDraft.trim()}>
              {ytsQ.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          </form>
          {ytsQ.isError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {errorDetail(ytsQ.error, getErrorMessage(ytsQ.error, "YTS search failed"))} Try again,
              or paste a link instead.
            </p>
          )}
          {ytsQ.isSuccess && ytsQ.data.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing on YTS for “{ytsQuery}”. Try another spelling, or the Subf2m tab.
            </p>
          )}
          {ytsQ.isSuccess && ytsQ.data.length > 0 && (
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {ytsQ.data.map((t) => (
                <button
                  key={t.imdb_id}
                  type="button"
                  aria-label={t.year ? `${t.title} (${t.year})` : t.title}
                  onClick={() =>
                    onPick({ title: t.title, year: t.year, type: "movie", imdb_id: t.imdb_id })
                  }
                  className="flex flex-col overflow-hidden rounded-md border border-border text-left transition-colors hover:border-primary/50"
                >
                  <span className="relative flex aspect-2/3 items-center justify-center bg-muted">
                    <Clapperboard className="h-6 w-6 text-muted-foreground/40" />
                    {t.poster_url && (
                      <img
                        src={t.poster_url}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="space-y-0.5 p-1.5">
                    <span className="line-clamp-2 block text-xs font-medium leading-tight">
                      {t.title}
                    </span>
                    <span className="block text-3xs text-muted-foreground tabular-nums">
                      {t.year ?? "—"} · {t.imdb_id}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="subf2m" className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Type the title and year as the subtitle site lists them. Subf2m is the only source for
            shows.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              placeholder="Title"
              className={`${fieldClass} min-w-40 flex-1`}
            />
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Year"
              placeholder="Year"
              inputMode="numeric"
              className={`${fieldClass} w-20 tabular-nums`}
            />
          </div>
          <RadioToggle value={mediaType} onChange={setMediaType} options={TYPE_OPTIONS} />
          <Button
            size="sm"
            disabled={!typed}
            onClick={() => onPick({ title: typed, year: parseYear(year), type: mediaType })}
          >
            Use this title
          </Button>
        </TabsContent>

        <TabsContent value="paste" className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            An IMDB id (tt0903747), an IMDB link, or a Subf2m page link. The title and year from the
            Subf2m tab go with an IMDB id.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              pasted.mutate(paste.trim());
            }}
          >
            <Input
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                pasted.reset();
              }}
              aria-label="IMDB id or link"
              placeholder="tt0903747 or a link"
              className={fieldClass}
            />
            <Button type="submit" size="sm" disabled={!paste.trim() || pasted.isPending}>
              {pasted.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Use
            </Button>
          </form>
          {pasted.isError && (
            <p className="text-xs text-destructive" role="alert">
              {errorDetail(pasted.error, "That is not an IMDB id or a Subf2m link.")}
            </p>
          )}
        </TabsContent>

        {hasTmdbKey && (
          <TabsContent value="tmdb" className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Search TMDB for posters and the exact year.
            </p>
            <Button size="sm" variant="outline" onClick={() => setTmdbOpen(true)}>
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Search TMDB…
            </Button>
          </TabsContent>
        )}
      </Tabs>

      {!hasTmdbKey && (
        <p className="text-3xs text-muted-foreground">
          Manual search is all set. A free TMDB key adds poster search and exact years; nothing here
          needs it.{" "}
          <Link to="/settings?tab=credentials" className="underline hover:text-foreground">
            Settings → Keys & Accounts
          </Link>
        </p>
      )}

      {tmdbOpen && (
        <MediaSearchDialog
          open
          onOpenChange={setTmdbOpen}
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
          initialQuery={typed}
          initialYear={parseYear(year)}
          selectedId={initial?.tmdb_id ?? null}
          onPick={(r) => {
            setTmdbOpen(false);
            onPick({
              title: r.title,
              year: r.year,
              type: r.type === "tv" ? "tv" : "movie",
              tmdb_id: r.tmdb_id,
            });
          }}
        />
      )}
    </div>
  );
}
