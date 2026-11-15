import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressBar } from "@/components/ProgressBar";
import { languageName } from "@/lib/subtitle-langs";
import { titleStatus } from "@/lib/subtitleGroups";
import { cn } from "@/lib/utils";
import type { LanguageCoverage, TitleGroup } from "@/types/subtitle";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One title of the folder (a show or a film) on the Home view: name, year, file and
 * season counts, a status pill, and a coverage bar per wanted language (real subtitles;
 * generated and translated ones are counted beside it, never as real). Clicking the name
 * opens the title's files; the checkbox selects it for the dock. Props-in/callbacks-out.
 */
export function TitleCard({
  group,
  files,
  seasons,
  wanted,
  coverage,
  selected,
  skipped = false,
  onToggleSelect,
  onOpen,
}: {
  group: TitleGroup;
  files: number;
  seasons: number;
  wanted: string[];
  coverage: Record<string, LanguageCoverage>;
  selected: boolean;
  /** Set aside by the user for this visit; only a label, the title still works. */
  skipped?: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const status = titleStatus(group, skipped);
  const name = group.year ? `${group.title} (${group.year})` : group.title;
  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-3 transition-shadow",
        selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary",
        skipped && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${group.title}`}
          className="mt-0.5 shrink-0"
        />
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${name}`}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-baseline gap-1.5">
            <span className="truncate font-medium">{group.title}</span>
            {group.year && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {group.year}
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {plural(files, "file")}
            {seasons > 0 && ` · ${plural(seasons, "season")}`}
          </span>
        </button>
        {status && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-3xs font-medium",
              status === "Layout looks right" && "border-primary/40 bg-primary/10 text-primary",
              status === "Pick which one" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
              status === "Skipped" && "border-border text-muted-foreground",
            )}
          >
            {status}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {wanted.map((lang) => {
          const c = coverage[lang] ?? { real: 0, generated: 0, translated: 0, total: files };
          const machine = c.generated + c.translated;
          return (
            <div key={lang} className="flex items-center gap-2 text-xs">
              <span className="w-6 shrink-0 font-mono text-3xs font-medium uppercase text-muted-foreground">
                {lang}
              </span>
              <ProgressBar
                value={c.total ? (c.real / c.total) * 100 : 0}
                label={`${languageName(lang)}: ${c.real} of ${c.total} with a real subtitle`}
                className="flex-1"
              />
              <span className="w-8 shrink-0 text-right font-mono tabular-nums">{c.real}</span>
              {machine > 0 && (
                <span className="shrink-0 text-3xs text-amber-500">
                  {c.generated > 0 && `${c.generated} generated`}
                  {c.generated > 0 && c.translated > 0 && " · "}
                  {c.translated > 0 && `${c.translated} translated`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
