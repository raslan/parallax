import { Link } from "react-router";
import { Languages, Loader2, Mic, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectionBar } from "@/components/SelectionBar";
import { SETTINGS_LINK } from "@/lib/subtitleCoverage";

/** An action's label: shown from `sm` up, icon only below it (the button keeps its name). */
const Label = ({ children }: { children: string }) => (
  <span className="hidden sm:inline">{children}</span>
);

/**
 * The Subtitles page's action dock for the selected titles or files: Find subtitles,
 * Translate, Generate and Sync. What the selected files already have never disables an
 * action; Translate and Generate are greyed only when they cannot work at all (no language
 * pack, no speech model), and then the reason shows as a link to Settings → Subtitles.
 * Below `sm` the buttons are icons only, so the dock stays one short row on a phone.
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
  onManage,
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
  /** Opens the Manage panel; enabled for exactly one selected video. */
  onManage?: () => void;
  onClear: () => void;
}) {
  const reasons = [blocked.translate, blocked.generate].filter((r): r is string => r !== null);
  const icon = "h-3.5 w-3.5 sm:mr-1.5";
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
      <Button size="sm" onClick={onFind} aria-label="Find subtitles…">
        <Search className={icon} />
        <Label>Find subtitles…</Label>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onTranslate}
        disabled={!!blocked.translate}
        aria-label="Translate…"
      >
        <Languages className={icon} />
        <Label>Translate…</Label>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onGenerate}
        disabled={!!blocked.generate}
        aria-label="Generate…"
      >
        <Mic className={icon} />
        <Label>Generate…</Label>
      </Button>
      {onManage && (
        <Button
          size="sm"
          variant="outline"
          onClick={onManage}
          disabled={files !== 1}
          aria-label="Manage"
          title={files === 1 ? undefined : "Select one video to manage its subtitle files"}
        >
          <SlidersHorizontal className={icon} />
          <Label>Manage</Label>
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onSync} disabled={syncing} aria-label="Sync">
        {syncing ? <Loader2 className={`${icon} animate-spin`} /> : <RefreshCw className={icon} />}
        <Label>Sync</Label>
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
