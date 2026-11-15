import { AlertTriangle } from "lucide-react";
import { Tip } from "@/components/Tip";
import { languageName } from "@/lib/subtitle-langs";
import { cn } from "@/lib/utils";
import type { LengthInfo, ScanFile, SubtitleKind } from "@/types/subtitle";

const badge = "rounded px-1.5 py-0.5 font-mono text-3xs font-medium uppercase leading-none";

/**
 * A video's subtitles at a glance: one badge per language it has (real; **Generated** and
 * **Translated** marked, in amber), the wanted languages it lacks in grey, and an amber
 * "looks short" mark when the length check found a subtitle ending well before the video.
 * `.original` backups are not shown here (only in Manage). Props-in.
 */
export function SubtitleBadges({
  file,
  wanted,
  length,
}: {
  file: ScanFile;
  wanted: string[];
  length: LengthInfo | null | undefined;
}) {
  const byLang = new Map<string, Set<SubtitleKind>>();
  for (const s of file.subtitles) {
    if (s.kind === "original") continue;
    const lang = s.language.toLowerCase();
    const kinds = byLang.get(lang) ?? new Set<SubtitleKind>();
    kinds.add(s.kind);
    byLang.set(lang, kinds);
  }
  const missing = wanted.filter((l) => !byLang.has(l.toLowerCase()));
  const short = length?.subtitles.some((s) => s.length === "short") ?? false;

  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {[...byLang].map(([lang, kinds]) => {
        const real = kinds.has("real") || kinds.has("hearing_impaired");
        const machine = [
          kinds.has("generated") && "Generated",
          kinds.has("translated") && "Translated",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <span key={lang} className="flex shrink-0 items-center gap-0.5">
            {real && (
              <span className={cn(badge, "bg-primary/15 text-primary")} title={languageName(lang)}>
                {lang}
              </span>
            )}
            {machine && (
              <span
                className={cn(badge, "bg-amber-500/15 text-amber-500 normal-case")}
                title={`${languageName(lang)}: ${machine.toLowerCase()} on this computer, not a real subtitle`}
              >
                {real ? machine : `${lang.toUpperCase()} ${machine}`}
              </span>
            )}
          </span>
        );
      })}
      {missing.map((lang) => (
        <span
          key={lang}
          className={cn(badge, "shrink-0 bg-muted/50 text-muted-foreground/50")}
          title={`No ${languageName(lang)} subtitle`}
        >
          {lang}
        </span>
      ))}
      {short && (
        <Tip label="A subtitle ends well before the video does, so it may be for another cut or be incomplete">
          <span className="flex shrink-0 items-center gap-0.5 text-3xs text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            looks short
          </span>
        </Tip>
      )}
    </span>
  );
}
