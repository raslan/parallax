import { StatPanel } from "@/components/StatPanel";
import { languageName } from "@/lib/subtitle-langs";
import type { LanguageCoverage } from "@/types/subtitle";

/**
 * The folder at a glance: titles, videos, how many videos have a real subtitle in each
 * wanted language, and how many generated or translated subtitles there are (counted
 * apart, never as real). Scrolls inside its own box on a phone. Props-in.
 */
export function SummaryStrip({
  titles,
  files,
  wanted,
  coverage,
}: {
  titles: number;
  files: number;
  wanted: string[];
  coverage: Record<string, LanguageCoverage>;
}) {
  const machine = wanted.reduce(
    (n, l) => n + (coverage[l]?.generated ?? 0) + (coverage[l]?.translated ?? 0),
    0,
  );
  return (
    <div className="overflow-x-auto">
      <StatPanel
        className="min-w-max md:min-w-0"
        stats={[
          { label: "Titles", value: titles.toLocaleString(), accent: true },
          { label: "Files", value: files.toLocaleString() },
          ...wanted.map((l) => ({
            label: languageName(l),
            value: (coverage[l]?.real ?? 0).toLocaleString(),
          })),
          { label: "Generated · translated", value: machine.toLocaleString() },
        ]}
      />
    </div>
  );
}
