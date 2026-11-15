import { Link } from "react-router";
import { Languages, Loader2, Mic, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectionBar } from "@/components/SelectionBar";

const SETTINGS_LINK = "/settings?tab=subtitles";

/**
 * The Subtitles page's action dock for the selected titles or files: Find subtitles,
 * Translate, Generate and Sync. What the selected files already have never disables an
 * action; Translate and Generate are greyed only when they cannot work at all (no language
 * pack, no speech model), and then the reason shows as a link to Settings → Subtitles.
 * Props-in/callbacks-out.
 */
export function SubtitleDock({
  count,
  files,
  blocked,
  syncing,
  onFind,
  onTranslate,
  onGenerate,
  onSync,
  onClear,
}: {
  /** Selected titles or files. */
  count: number;
  /** Videos the selection covers. */
  files: number;
  blocked: { translate: string | null; generate: string | null };
  syncing: boolean;
  onFind: () => void;
  onTranslate: () => void;
  onGenerate: () => void;
  onSync: () => void;
  onClear: () => void;
}) {
  const reasons = [blocked.translate, blocked.generate].filter((r): r is string => r !== null);
  return (
    <SelectionBar
      count={count}
      onClear={onClear}
      summary={
        <span className="text-xs text-muted-foreground tabular-nums">
          {files} {files === 1 ? "video" : "videos"}
        </span>
      }
    >
      <Button size="sm" onClick={onFind}>
        <Search className="mr-1.5 h-3.5 w-3.5" />
        Find subtitles…
      </Button>
      <Button size="sm" variant="outline" onClick={onTranslate} disabled={!!blocked.translate}>
        <Languages className="mr-1.5 h-3.5 w-3.5" />
        Translate…
      </Button>
      <Button size="sm" variant="outline" onClick={onGenerate} disabled={!!blocked.generate}>
        <Mic className="mr-1.5 h-3.5 w-3.5" />
        Generate…
      </Button>
      <Button size="sm" variant="outline" onClick={onSync} disabled={syncing}>
        {syncing ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Sync
      </Button>
      {reasons.length > 0 && (
        <span className="flex flex-col text-3xs leading-tight">
          {reasons.map((r) => (
            <Link
              key={r}
              to={SETTINGS_LINK}
              className="text-muted-foreground underline hover:text-foreground"
            >
              {r}
            </Link>
          ))}
        </span>
      )}
    </SelectionBar>
  );
}
