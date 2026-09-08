import { Loader2, FolderOpen, FolderInput, Search, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export type IdentifyMode = "tv" | "movie" | "custom";

export interface SelectedMedia {
  tmdb_id: number;
  title: string;
  year: number | null;
  type: "tv" | "movie";
  number_of_seasons: number | null;
  poster_path: string | null;
}

interface SetupBarProps {
  folderPath: string;
  fileCount: number;
  loadingFiles: boolean;
  onBrowseSource: () => void;

  targetDir: string;
  onBrowseTarget: () => void;
  onClearTarget: () => void;

  mode: IdentifyMode;
  onModeChange: (m: IdentifyMode) => void;

  // TMDB modes
  selected: SelectedMedia | null;
  loadingEpisodes: boolean;
  episodeCount: number;
  onOpenSearch: () => void;

  // Custom mode
  showName: string;
  onShowNameChange: (v: string) => void;
  season: number;
  onSeasonChange: (v: number) => void;
}

function Segment({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[var(--px-bg-surface)] p-3">
      {children}
    </div>
  );
}

function SegmentLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

const MODES: { key: IdentifyMode; label: string }[] = [
  { key: "tv", label: "TV" },
  { key: "movie", label: "Movie" },
  { key: "custom", label: "Custom" },
];

export function SetupBar({
  folderPath,
  fileCount,
  loadingFiles,
  onBrowseSource,
  targetDir,
  onBrowseTarget,
  onClearTarget,
  mode,
  onModeChange,
  selected,
  loadingEpisodes,
  episodeCount,
  onOpenSearch,
  showName,
  onShowNameChange,
  season,
  onSeasonChange,
}: SetupBarProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {/* Source */}
      <Segment>
        <SegmentLabel>Source folder</SegmentLabel>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate font-mono text-sm text-foreground" title={folderPath}>
            {folderPath || <span className="italic text-muted-foreground">None selected</span>}
          </span>
          {loadingFiles && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBrowseSource}
            className="shrink-0 gap-1.5"
          >
            <FolderOpen className="h-4 w-4" />
            Browse
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {fileCount > 0 ? (
            <>
              <span className="font-medium text-foreground">{fileCount}</span> video file
              {fileCount === 1 ? "" : "s"} found
            </>
          ) : (
            "Pick the folder to rename"
          )}
        </p>
      </Segment>

      {/* Move to */}
      <Segment>
        <SegmentLabel>Move to</SegmentLabel>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate font-mono text-sm text-muted-foreground"
            title={targetDir}
          >
            {targetDir || <span className="italic">Rename in place</span>}
          </span>
          {targetDir && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearTarget}
              className="shrink-0"
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBrowseTarget}
            disabled={!folderPath}
            title={folderPath ? undefined : "Pick a source folder first"}
            className="shrink-0 gap-1.5"
          >
            <FolderInput className="h-4 w-4" />
            Choose
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Optional — the renamed folder is moved here</p>
      </Segment>

      {/* Show / Movie / Custom */}
      <Segment>
        <div className="flex items-center justify-between gap-2">
          <SegmentLabel>
            {mode === "custom" ? "Custom show" : mode === "tv" ? "Show" : "Movie"}
          </SegmentLabel>
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onModeChange(m.key)}
                className={`px-2.5 py-1 transition-colors ${
                  mode === m.key ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "custom" ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={showName}
              onChange={(e) => onShowNameChange(e.target.value)}
              placeholder="Show name"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              Season
              <input
                type="number"
                min={0}
                value={season}
                onChange={(e) => onSeasonChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-14 rounded-md border border-input bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </div>
        ) : selected ? (
          <div className="flex items-center gap-2.5">
            {selected.poster_path ? (
              <img
                src={`https://image.tmdb.org/t/p/w200${selected.poster_path}`}
                alt=""
                className="h-14 w-10 shrink-0 rounded bg-muted object-cover"
              />
            ) : (
              <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted">
                <Clapperboard className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={selected.title}>
                {selected.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {selected.year ?? "—"}
                {loadingEpisodes ? (
                  <span className="ml-1.5 inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> loading episodes
                  </span>
                ) : (
                  mode === "tv" &&
                  episodeCount > 0 && <span className="ml-1.5">· {episodeCount} episodes</span>
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenSearch}
              className="shrink-0"
            >
              Change
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSearch}
            className="w-full gap-1.5"
          >
            <Search className="h-4 w-4" />
            Search TMDB
          </Button>
        )}
      </Segment>
    </div>
  );
}
