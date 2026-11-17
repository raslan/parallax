import { Checkbox } from "@/components/ui/checkbox";
import type { RunOptions, SyncEngine } from "@/lib/subtitleRunDock";
import { cn } from "@/lib/utils";

const ENGINES: SyncEngine[] = ["alass", "ffsubsync"];

/**
 * The two run tickboxes and the sync engine: Keep existing subtitles, Sync after download
 * (alass | ffsubsync). Used by the download dock of the Matches view and, when the sure
 * matches are saved automatically, by the Titles step. The choices are page state, off on
 * every start and never remembered. Props-in/callbacks-out.
 */
export function RunOptionsControls({
  options,
  onChange,
}: {
  options: RunOptions;
  onChange: (change: Partial<RunOptions>) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-1.5 text-xs">
        <Checkbox
          checked={options.keepExisting}
          onCheckedChange={(v) => onChange({ keepExisting: v === true })}
          aria-label="Keep existing subtitles"
        />
        Keep existing subtitles
      </label>
      <span className="flex items-center gap-1.5 text-xs">
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={options.syncAfter}
            onCheckedChange={(v) => onChange({ syncAfter: v === true })}
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
              onClick={() => onChange({ engine: e })}
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
    </>
  );
}
