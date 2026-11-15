import { useState } from "react";
import { Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioToggle } from "@/components/RadioToggle";
import { IdentityPicker } from "@/components/subtitles/IdentityPicker";
import { titleStatus } from "@/lib/subtitleGroups";
import { cn } from "@/lib/utils";
import type { Identity, PlanScope, TitleChoice } from "@/types/subtitle";

const SCOPES: { id: PlanScope; label: string }[] = [
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
}: {
  titles: TitleChoice[];
  scope: PlanScope;
  onScopeChange: (s: PlanScope) => void;
  hasTmdbKey: boolean;
  onIdentity: (key: string, identity: Identity) => void;
  onToggleSkip: (key: string) => void;
  onSearch: () => void;
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

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onSearch} disabled={included.length === 0}>
          <Search className="mr-1.5 h-3.5 w-3.5" />
          Search subtitles for {included.length} {included.length === 1 ? "title" : "titles"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Searching only reads the subtitle sites. Nothing is saved until you download.
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
