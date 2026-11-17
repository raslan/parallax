import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProgressBar } from "@/components/ProgressBar";
import { MatchRow } from "@/components/subtitles/MatchRow";
import { languageName } from "@/lib/subtitle-langs";
import {
  defaultRunOptions,
  isClean,
  runItems,
  sourceName,
  type RunOptions,
  type SyncEngine,
} from "@/lib/subtitleRunDock";
import { cn } from "@/lib/utils";
import type { MatchRowState, RunItem } from "@/types/subtitle";

const ENGINES: SyncEngine[] = ["alass", "ffsubsync"];
const NONE: ReadonlySet<string> = new Set();

/** What a title (or the whole view) has: ready to download, to check, nothing found. */
function counts(rows: MatchRowState[]) {
  let ready = 0;
  let flagged = 0;
  let none = 0;
  let failed = 0;
  let checking = 0;
  for (const r of rows) {
    if (r.status === "ready" || r.status === "replaces_machine") ready++;
    else if (r.status === "flagged") flagged++;
    else if (r.status === "none") none++;
    else if (r.status === "failed") failed++;
    else if (r.status === "checking") checking++;
  }
  return { ready, flagged, none, failed, checking };
}

function countLine(c: ReturnType<typeof counts>): string {
  const parts = [`${c.ready} ready`];
  if (c.flagged) parts.push(`${c.flagged} to check`);
  if (c.none) parts.push(`${c.none} nothing found`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.checking) parts.push(`${c.checking} searching`);
  return parts.join(" · ");
}

/** The rail's word for a title. */
function railStatus(c: ReturnType<typeof counts>): { text: string; tone: string } {
  if (c.checking) return { text: "searching", tone: "bg-primary/60" };
  if (c.failed) return { text: `${c.failed} failed`, tone: "bg-amber-500" };
  if (c.flagged) return { text: `${c.flagged} to check`, tone: "bg-amber-500" };
  // "all clean" only when every row found something; a row with nothing is not clean.
  if (c.none) return { text: `nothing found for ${c.none}`, tone: "bg-amber-500" };
  return { text: "all clean", tone: "bg-primary" };
}

interface Season {
  key: string;
  label: string;
  videos: { video: string; cells: (MatchRowState | undefined)[] }[];
  rows: MatchRowState[];
}

/** A title's rows as seasons of videos, each video with a cell per wanted language. */
function seasonsOf(rows: MatchRowState[], wanted: string[]): Season[] {
  const byVideo = new Map<string, Map<string, MatchRowState>>();
  for (const r of rows) {
    const m = byVideo.get(r.video) ?? new Map<string, MatchRowState>();
    m.set(r.language, r);
    byVideo.set(r.video, m);
  }
  const seasons = new Map<string, Season>();
  for (const [video, cells] of byVideo) {
    const first = cells.values().next().value;
    const s = first?.season;
    const key = s == null ? "none" : String(s);
    const season = seasons.get(key) ?? {
      key,
      label: s == null ? "Files" : `Season ${s}`,
      videos: [],
      rows: [],
    };
    season.videos.push({ video, cells: wanted.map((l) => cells.get(l)) });
    season.rows.push(...cells.values());
    seasons.set(key, season);
  }
  return [...seasons.values()];
}

/** A season with nothing to decide: every cell has a real subtitle or found nothing. */
const quiet = (s: Season) => s.rows.every((r) => r.status === "has_real" || r.status === "none");

function seasonSummary(s: Season, lang: string): string {
  const rows = s.rows.filter((r) => r.language === lang);
  const real = rows.filter((r) => r.status === "has_real").length;
  const none = rows.filter((r) => r.status === "none").length;
  const parts = [];
  if (real) parts.push(`${real} have a real subtitle`);
  if (none) parts.push(`none found for ${none}`);
  return parts.join(" · ") || "—";
}

/**
 * The matches of a "Find subtitles" run: a rail of titles (a select on a phone), "Approve all
 * clean rows" across every title (never a flagged row), the search and length-check
 * progress of the server's search job with its Cancel (nothing else controls a running search),
 * and the open title's videos with a column per wanted language; a season where nothing
 * needs a decision shows as one summary line.
 * Searching is read-only. The dock holds the two run tickboxes, off on every mount and
 * never remembered, the sync engine (Settings' by default) and Download. `renderMachine`
 * puts the Generated and translated section below, with the same Keep existing choice.
 * Props-in/callbacks-out; the tickboxes, the open title and the open seasons are view state.
 */
export function MatchesView({
  titles,
  rows,
  wanted,
  progress,
  checks,
  running,
  jobStatus,
  jobError,
  cancelling,
  onCancel,
  checksSkipped,
  errors,
  notes = [],
  onToggleUse,
  onApproveAllClean,
  unconfirmed = NONE,
  onPickTitle,
  onFindAnother,
  onCompare,
  settingsEngine,
  downloading,
  onDownload,
  renderMachine,
}: {
  titles: { key: string; name: string }[];
  rows: MatchRowState[];
  wanted: string[];
  progress: { done: number; total: number };
  checks: { done: number; total: number };
  /** The search job is still working (waiting or running). */
  running: boolean;
  /** The job's status, null until it has been read. */
  jobStatus: string | null;
  jobError: string | null;
  cancelling: boolean;
  /** Cancels the search job; what it found so far stays. */
  onCancel: () => void;
  /** This search did not check lengths (so a row without a length result is settled). */
  checksSkipped: boolean;
  errors: { provider: string; message: string; count?: number }[];
  /** Sources that do not apply (films only): shown plainly, never as a failure. */
  notes?: { provider: string; message: string; count?: number }[];
  onToggleUse: (key: string) => void;
  /** `exclude`: the keys of titles whose identity is not confirmed, to leave out. */
  onApproveAllClean: (exclude: ReadonlySet<string>) => void;
  onFindAnother: (key: string) => void;
  /** Titles the user has not confirmed the identity of ("Pick which one"): a suggestion, never a block. */
  unconfirmed?: ReadonlySet<string>;
  /** Back to the Titles step to pick which show or film a title is. */
  onPickTitle?: () => void;
  /** Opens the Compare sheet for a row (Task 14). */
  onCompare: (row: MatchRowState) => void;
  settingsEngine: string;
  downloading: boolean;
  onDownload: (run: {
    items: RunItem[];
    keep_existing: boolean;
    sync_after: boolean;
    engine: SyncEngine;
  }) => void;
  renderMachine?: (keepExisting: boolean) => ReactNode;
}) {
  // The run options start from the defaults on every mount and are never saved.
  const [touched, setTouched] = useState<Partial<RunOptions>>({});
  const options: RunOptions = { ...defaultRunOptions(settingsEngine), ...touched };
  const [picked, setPicked] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());

  const byTitle = useMemo(() => {
    const m = new Map<string, MatchRowState[]>();
    for (const r of rows) m.set(r.title, [...(m.get(r.title) ?? []), r]);
    return m;
  }, [rows]);
  const active = titles.find((t) => t.key === picked) ?? titles[0];
  const activeRows = useMemo(
    () => (active ? (byTitle.get(active.key) ?? []) : []),
    [active, byTitle],
  );
  const seasons = useMemo(() => seasonsOf(activeRows, wanted), [activeRows, wanted]);

  const all = counts(rows);
  // A title whose identity the user has not confirmed is never "clean": a wrong guess would
  // download the wrong show's subtitles. Its rows can still be approved one by one.
  const clean = rows.filter(
    (r) => isClean(r, checksSkipped) && !r.verdict && !unconfirmed.has(r.title),
  ).length;
  const items = runItems(rows);
  // The server's search is still working: first the searches, then the length checks.
  const searching = running && progress.done < progress.total;
  const checking = running && !searching && !checksSkipped && checks.done < checks.total;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onApproveAllClean(unconfirmed)}
          disabled={clean === 0}
        >
          Approve all clean rows ({clean})
        </Button>
        <span className="text-xs text-muted-foreground">Leaves anything flagged for you.</span>
      </div>

      {running && (
        <div
          className="space-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs"
          role="status"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">
              {checking
                ? "Checking subtitle lengths"
                : searching
                  ? "Searching the sources"
                  : "Starting the search"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {checking
                ? `${checks.done} of ${checks.total}`
                : `${progress.done} of ${progress.total}`}
            </span>
            <ProgressBar
              value={
                checking
                  ? (checks.done / Math.max(checks.total, 1)) * 100
                  : (progress.done / Math.max(progress.total, 1)) * 100
              }
              label={checking ? "Length check progress" : "Search progress"}
              className="min-w-24 flex-1"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={onCancel}
              disabled={cancelling}
              aria-label="Cancel search"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground">
            Searching and checking runs on the server. You can leave this page.
          </p>
        </div>
      )}

      {jobStatus === "cancelled" && (
        <p className="text-xs text-muted-foreground" role="status">
          This search was cancelled. What it found before that is shown below.
        </p>
      )}

      {jobStatus === "failed" && (
        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            The search failed{jobError ? `: ${jobError}` : "."}
          </span>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {notes.map((n) => (
            <li key={`${n.provider}:${n.message}`}>
              {sourceName(n.provider)}: {n.message}
              {n.count ? ` (${n.count} ${n.count === 1 ? "search" : "searches"} skipped)` : ""}
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <div
          className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <ul className="min-w-0 flex-1 space-y-0.5">
            {errors.map((e) => (
              <li key={`${e.provider}:${e.message}`}>
                <span className="font-medium">{sourceName(e.provider)}:</span> {e.message}
                {e.count ? ` (${e.count} ${e.count === 1 ? "search" : "searches"})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-6">
        {titles.length > 1 && (
          <nav aria-label="Titles" className="hidden w-52 shrink-0 space-y-0.5 md:block">
            {titles.map((t) => {
              const s = unconfirmed.has(t.key)
                ? { text: "identity not confirmed", tone: "bg-amber-500" }
                : railStatus(counts(byTitle.get(t.key) ?? []));
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-current={t.key === active?.key ? "page" : undefined}
                  onClick={() => setPicked(t.key)}
                  className={cn(
                    "flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    t.key === active?.key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", s.tone)} />
                    {s.text}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          {titles.length > 1 && (
            <Select value={active?.key ?? ""} onValueChange={setPicked}>
              <SelectTrigger aria-label="Title" className="h-8 text-sm md:hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {titles.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {active && (
            <div>
              <h2 className="truncate text-lg font-semibold tracking-tight">{active.name}</h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                {countLine(counts(activeRows))}
              </p>
            </div>
          )}

          {active && unconfirmed.has(active.key) && (
            <div
              role="note"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Identity not confirmed. Pick which show or film this is before trusting these
                matches.
              </span>
              {onPickTitle && (
                <Button size="sm" variant="outline" className="h-7" onClick={onPickTitle}>
                  Pick which one…
                </Button>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <div className="min-w-[32rem]">
              <div
                className="grid gap-3 bg-muted/30 px-3 py-1.5 text-3xs font-medium uppercase tracking-widest text-muted-foreground"
                style={{ gridTemplateColumns: `5.5rem repeat(${wanted.length}, minmax(0, 1fr))` }}
              >
                <span>Episode</span>
                {wanted.map((l) => (
                  <span key={l}>{languageName(l)}</span>
                ))}
              </div>
              {seasons.map((s) => {
                const open = quiet(s) === flipped.has(s.key);
                const toggle = () =>
                  setFlipped((f) => {
                    const next = new Set(f);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  });
                return (
                  <div key={s.key}>
                    {seasons.length > 1 || quiet(s) ? (
                      <button
                        type="button"
                        onClick={toggle}
                        aria-expanded={open}
                        className="grid w-full items-start gap-3 border-t border-border/60 px-3 py-2 text-left text-xs hover:bg-muted/20"
                        style={{
                          gridTemplateColumns: `5.5rem repeat(${wanted.length}, minmax(0, 1fr))`,
                        }}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          {s.label}
                        </span>
                        {wanted.map((l) => (
                          <span key={l} className="text-muted-foreground">
                            {open
                              ? `${s.videos.length} ${s.videos.length === 1 ? "file" : "files"}`
                              : seasonSummary(s, l)}
                          </span>
                        ))}
                      </button>
                    ) : null}
                    {open &&
                      s.videos.map((v) => (
                        <MatchRow
                          key={v.video}
                          cells={v.cells}
                          wanted={wanted}
                          keepExisting={options.keepExisting}
                          checksSkipped={checksSkipped}
                          onToggleUse={onToggleUse}
                          onFindAnother={onFindAnother}
                          onCompare={onCompare}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {renderMachine?.(options.keepExisting)}

      <div
        role="region"
        aria-label="Download"
        className="fixed inset-x-4 bottom-20 z-30 flex animate-slide-up-fade flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-xl md:inset-x-auto md:bottom-6 md:left-1/2 md:w-max md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2"
      >
        <span className="text-xs text-muted-foreground tabular-nums">{countLine(all)}</span>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={options.keepExisting}
            onCheckedChange={(v) => setTouched((t) => ({ ...t, keepExisting: v === true }))}
            aria-label="Keep existing subtitles"
          />
          Keep existing subtitles
        </label>
        <span className="flex items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={options.syncAfter}
              onCheckedChange={(v) => setTouched((t) => ({ ...t, syncAfter: v === true }))}
              aria-label="Sync after download"
            />
            Sync after download
          </label>
          <span className="flex overflow-hidden rounded-md border border-border">
            {ENGINES.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={options.engine === e}
                onClick={() => setTouched((t) => ({ ...t, engine: e }))}
                className={cn(
                  "px-2 py-0.5 font-mono text-3xs transition-colors",
                  options.engine === e
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {e}
              </button>
            ))}
          </span>
        </span>
        <Button
          size="sm"
          disabled={items.length === 0 || downloading}
          onClick={() =>
            onDownload({
              items,
              keep_existing: options.keepExisting,
              sync_after: options.syncAfter,
              engine: options.engine,
            })
          }
        >
          {downloading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          Download {items.length} {items.length === 1 ? "subtitle" : "subtitles"}
        </Button>
      </div>
    </div>
  );
}
