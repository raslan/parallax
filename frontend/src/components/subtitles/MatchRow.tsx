import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDuration } from "@/lib/format";
import { languageName } from "@/lib/subtitle-langs";
import { sourceName } from "@/lib/subtitleRunDock";
import { SeasonPackTag } from "@/components/subtitles/SeasonPackTag";
import type { MatchRowState } from "@/types/subtitle";

/** The S01E03 label of a row, else the file name. */
function episodeLabel(r: Pick<MatchRowState, "season" | "episode" | "filename">): string {
  if (r.season != null && r.episode != null)
    return `S${String(r.season).padStart(2, "0")}E${String(r.episode).padStart(2, "0")}`;
  return r.filename;
}

/** What the length check said about a row's top candidate, as a short line. */
function LengthLine({ row, checksSkipped }: { row: MatchRowState; checksSkipped: boolean }) {
  const l = row.lengthResult;
  if (!l)
    return (
      <span className="text-muted-foreground">
        {checksSkipped ? "length not checked" : "checking length…"}
      </span>
    );
  if ("error" in l) return <span className="text-muted-foreground">length not checked</span>;
  if (l.length === "short" || l.length === "long")
    return (
      <span className="text-amber-500">
        Check: ends at {formatDuration(l.last)}
        {l.videoDuration ? `, video is ${formatDuration(l.videoDuration)}` : ""}
      </span>
    );
  if (l.length === "ok")
    return (
      <span className="text-muted-foreground">
        length ✓ {formatDuration(l.last)}
        {l.videoDuration ? ` of ${formatDuration(l.videoDuration)}` : ""}
      </span>
    );
  return <span className="text-muted-foreground">length unknown</span>;
}

/** One cell: a video in one wanted language. */
function MatchCell({
  row,
  keepExisting,
  checksSkipped,
  onToggleUse,
  onFindAnother,
  onCompare,
}: {
  row: MatchRowState;
  keepExisting: boolean;
  checksSkipped: boolean;
  onToggleUse: (key: string) => void;
  onFindAnother: (key: string) => void;
  onCompare: (row: MatchRowState) => void;
}) {
  const label = `${episodeLabel(row)} ${languageName(row.language)}`;
  if (row.status === "checking")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Searching…
      </span>
    );
  if (row.status === "has_real")
    return (
      <div className="space-y-0.5 text-xs">
        <p>Has a real subtitle</p>
        <button
          type="button"
          onClick={() => onFindAnother(row.key)}
          aria-label={`Find another for ${label}`}
          className="flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Search className="h-3 w-3" />
          Find another…
        </button>
      </div>
    );
  if (row.status === "none" || !row.candidate)
    return (
      <div className="space-y-0.5 text-xs">
        <p className="text-muted-foreground">None found</p>
        {row.errors.map((e) => (
          <p key={`${e.provider}:${e.message}`} className="text-3xs text-muted-foreground">
            {sourceName(e.provider)}: {e.message}
          </p>
        ))}
      </div>
    );
  const c = row.candidate;
  const using = row.verdict === "use" || row.verdict === "use_and_sync";
  return (
    <div className="flex items-start gap-2 text-xs">
      <Checkbox
        checked={using}
        onCheckedChange={() => onToggleUse(row.key)}
        aria-label={`Download ${label}`}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-sm border border-border px-1 text-3xs font-medium">
            {sourceName(c.provider)}
          </span>
          <SeasonPackTag candidate={c} />
          <span className="truncate font-mono text-2xs" title={c.release}>
            {c.release}
          </span>
        </p>
        <p className="text-3xs">
          <LengthLine row={row} checksSkipped={checksSkipped} />
          {row.verdict === "use_and_sync" && (
            <span className="text-muted-foreground"> · then sync</span>
          )}
        </p>
        {row.hasReal && !keepExisting && (
          <p className="text-3xs text-amber-500">Replaces the existing subtitle</p>
        )}
        {row.machineKind && !keepExisting && (
          <p className="text-3xs text-amber-500">
            Replaces the {row.machineKind} {languageName(row.language)} file
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-3xs"
        aria-label={`Compare candidates for ${label}`}
        onClick={() => onCompare(row)}
      >
        Compare
      </Button>
    </div>
  );
}

/**
 * One video of the matches: its episode label, then a cell per wanted language with the chosen
 * candidate (source, release, length check, a tickbox to download it, Compare), "Has a
 * real subtitle" with Find another, or "None found" with each source's reason. When Keep
 * existing is off and a generated or translated file of that language exists, the cell
 * says the download replaces it. Props-in/callbacks-out.
 */
export function MatchRow({
  cells,
  wanted,
  keepExisting,
  checksSkipped,
  onToggleUse,
  onFindAnother,
  onCompare,
}: {
  /** The row's cells in `wanted` order (a missing language has none). */
  cells: (MatchRowState | undefined)[];
  wanted: string[];
  keepExisting: boolean;
  checksSkipped: boolean;
  onToggleUse: (key: string) => void;
  onFindAnother: (key: string) => void;
  onCompare: (row: MatchRowState) => void;
}) {
  const first = cells.find((c) => c);
  if (!first) return null;
  return (
    <div
      className="grid items-start gap-3 border-t border-border/60 px-3 py-2"
      style={{ gridTemplateColumns: `5.5rem repeat(${wanted.length}, minmax(0, 1fr))` }}
    >
      <span className="truncate font-mono text-xs" title={first.filename}>
        {episodeLabel(first)}
      </span>
      {cells.map((row, i) =>
        row ? (
          <MatchCell
            key={row.key}
            row={row}
            keepExisting={keepExisting}
            checksSkipped={checksSkipped}
            onToggleUse={onToggleUse}
            onFindAnother={onFindAnother}
            onCompare={onCompare}
          />
        ) : (
          <span key={wanted[i]} className="text-xs text-muted-foreground">
            —
          </span>
        ),
      )}
    </div>
  );
}
