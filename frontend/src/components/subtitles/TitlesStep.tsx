import { useState } from "react";
import { Loader2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioToggle } from "@/components/RadioToggle";
import { Checkbox } from "@/components/ui/checkbox";
import { RunOptionsControls } from "@/components/subtitles/RunOptionsControls";
import type { RunOptions } from "@/lib/subtitleRunDock";
import { IdentityPicker } from "@/components/subtitles/IdentityPicker";
import { titleStatus } from "@/lib/subtitleGroups";
import { cn } from "@/lib/utils";
import type { Identity, MatchScope, TitleChoice } from "@/types/subtitle";

const SCOPES: { id: MatchScope; label: string }[] = [
  { id: "missing", label: "Only files missing a language" },
  { id: "all", label: "Everything selected" },
];

function describe(id: Identity): string {
  const parts = [
    id.year ? `${id.title} (${id.year})` : id.title,
    id.type === "tv" ? "show" : "film",
  ];
  if (id.imdb_id) parts.push(id.imdb_id);
  if (id.tmdb_id) parts.push(`TMDB ${id.tmdb_id}`);
  if (id.subf2m_path) parts.push(`Subf2m page ${id.subf2m_path.replace("/subtitles/", "")}`);
  return parts.join(" · ");
}

/**
 * The first part of "Find subtitles": what each title group is. Each group shows the
 * identity the search will use (from the file and folder names, pre-confirmed for a clean
 * Identify layout) with Change… to pick it by hand, and Skip to leave it out of this run.
 * The scope control decides whether languages that already have a real subtitle are
 * searched too. Props-in/callbacks-out; which group is being changed is view state.
 */
export function TitlesStep({
  titles,
  scope,
  onScopeChange,
  hasTmdbKey,
  onIdentity,
  onToggleSkip,
  onSearch,
  busy = false,
  checkLengths,
  onCheckLengthsChange,
  autoSave,
  onAutoSaveChange,
  saveOptions,
  onSaveOptionsChange,
}: {
  titles: TitleChoice[];
  scope: MatchScope;
  onScopeChange: (s: MatchScope) => void;
  hasTmdbKey: boolean;
  onIdentity: (key: string, identity: Identity) => void;
  onToggleSkip: (key: string) => void;
  onSearch: () => void;
  /** The search is being started on the server: the button waits. */
  busy?: boolean;
  /** Compare each best match's last line with the video's length. Forced on by `autoSave`. */
  checkLengths: boolean;
  onCheckLengthsChange: (v: boolean) => void;
  /** Save the sure matches as the search finds them (off: review each match). */
  autoSave: boolean;
  onAutoSaveChange: (v: boolean) => void;
  /** The run options an automatic save uses (Keep existing, Sync after, the engine). */
  saveOptions: RunOptions;
  onSaveOptionsChange: (change: Partial<RunOptions>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const edited = titles.find((t) => t.key === editing) ?? null;
  const included = titles.filter((t) => !t.skipped);

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {titles.map((t) => {
          const status = titleStatus(t.group, t.skipped);
          return (
            <li
              key={t.key}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2",
                t.skipped && "opacity-70",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-medium">{t.group.title}</span>
                  {status && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-3xs font-medium",
                        status === "Layout looks right" &&
                          "border-primary/40 bg-primary/10 text-primary",
                        status === "Pick which one" &&
                          "border-amber-500/40 bg-amber-500/10 text-amber-500",
                        status === "Skipped" && "border-border text-muted-foreground",
                      )}
                    >
                      {status}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.files} {t.files === 1 ? "file" : "files"} · searching as {describe(t.identity)}
                </p>
              </div>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(t.key)}>
                <Pencil className="mr-1 h-3 w-3" />
                Change…
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => onToggleSkip(t.key)}>
                {t.skipped ? "Include" : "Skip"}
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Search for</p>
        <RadioToggle value={scope} onChange={onScopeChange} options={SCOPES} />
      </div>

      <label
        className="flex w-fit items-center gap-2 text-sm"
        title={autoSave ? "Needed to save automatically" : undefined}
      >
        <Checkbox
          checked={checkLengths || autoSave}
          disabled={autoSave}
          onCheckedChange={(v) => onCheckLengthsChange(v === true)}
          aria-label="Check lengths"
        />
        Check lengths
        <span className="text-xs text-muted-foreground">
          Compares each best match with the video's length.
        </span>
      </label>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">After searching</p>
        <RadioToggle
          value={autoSave ? "auto" : "review"}
          onChange={(v) => onAutoSaveChange(v === "auto")}
          options={[
            { id: "review", label: "Review each match" },
            { id: "auto", label: "Save the sure matches automatically" },
          ]}
        />
        {autoSave && (
          <div className="space-y-2 rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-xs text-muted-foreground">
              A match is saved only when the title is confirmed, it is the exact episode (a season
              pack is never saved this way) and its length fits the video. Everything else is left
              for you to review.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <RunOptionsControls options={saveOptions} onChange={onSaveOptionsChange} />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onSearch} disabled={included.length === 0 || busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-3.5 w-3.5" />
          )}
          {autoSave ? "Search and save for" : "Search subtitles for"} {included.length}{" "}
          {included.length === 1 ? "title" : "titles"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {autoSave
            ? "The sure matches are saved beside their videos as the search goes."
            : "Searching only reads the subtitle sites. Nothing is saved until you download."}
        </span>
      </div>

      {edited && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-2xl" onClose={() => setEditing(null)}>
            <DialogHeader>
              <DialogTitle>
                Which {edited.group.type === "tv" ? "show" : "film"} is this?
              </DialogTitle>
            </DialogHeader>
            <IdentityPicker
              initial={edited.identity}
              hasTmdbKey={hasTmdbKey}
              type={edited.identity.type}
              onPick={(identity) => {
                onIdentity(edited.key, identity);
                setEditing(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
