import { Loader2, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export interface CustomRow {
  path: string;
  episode: number;
  title: string;
}

interface CustomEpisodeListProps {
  rows: CustomRow[];
  season: number;
  onTitleEdit: (path: string, value: string) => void;
  onMove: (path: string, dir: -1 | 1) => void;
  onSort: (by: "name" | "date") => void;
  onReverse: () => void;
  genericTitles: boolean;
  onGenericTitlesChange: (v: boolean) => void;
  activeSort: "name" | "date" | "manual";
  datesLoading: boolean;
  datesUnavailable: boolean;
}

function filename(path: string): string {
  return path.split("/").pop() ?? path;
}

function code(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function CustomEpisodeList({
  rows,
  season,
  onTitleEdit,
  onMove,
  onSort,
  onReverse,
  genericTitles,
  onGenericTitlesChange,
  activeSort,
  datesLoading,
  datesUnavailable,
}: CustomEpisodeListProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{rows.length}</span> episodes
          {rows.length > 0 && (
            <span className="ml-1.5 font-mono">
              · {code(season, 1)}–{code(season, rows.length)}
            </span>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={genericTitles}
              onChange={(e) => onGenericTitlesChange(e.target.checked)}
            />
            Generic titles
          </label>
          <Button
            type="button"
            size="sm"
            variant={activeSort === "name" ? "default" : "outline"}
            onClick={() => onSort("name")}
          >
            Name
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeSort === "date" ? "default" : "outline"}
            onClick={() => onSort("date")}
            disabled={datesLoading || datesUnavailable}
            title={datesUnavailable ? "No upload dates embedded in these files" : undefined}
            className="gap-1.5"
          >
            {datesLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Upload date
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onReverse} className="gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Reverse
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        {rows.map((row, i) => (
          <div
            key={row.path}
            className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"
          >
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => onMove(row.path, -1)}
                disabled={i === 0}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                title="Move up"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onMove(row.path, 1)}
                disabled={i === rows.length - 1}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                title="Move down"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <img
              src={api.identifyThumbnailUrl(row.path)}
              alt=""
              className="h-12 w-[5.5rem] shrink-0 rounded bg-muted object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />

            <span className="w-16 shrink-0 font-mono text-xs font-medium text-muted-foreground">
              {code(season, row.episode)}
            </span>

            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={row.title}
                onChange={(e) => onTitleEdit(row.path, e.target.value)}
                disabled={genericTitles}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={row.path}>
                {filename(row.path)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
