import { SectionHeader } from "@/components/SectionHeader";

/**
 * Summary-stat strip: one seamless bordered row split into N equal cells,
 * each a `SectionHeader` label above a big tabular-nums number. Column count
 * follows `stats.length`. `accent` tints a value with the theme accent.
 */
export function StatPanel({
  stats,
  className = "",
}: {
  stats: { label: string; value: string; accent?: boolean }[];
  className?: string;
}) {
  return (
    <div
      className={`grid border border-border rounded-[0.4rem] overflow-hidden divide-x divide-border ${className}`}
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map(({ label, value, accent }) => (
        <div key={label} className="px-7 py-5">
          <SectionHeader className="mb-2">{label}</SectionHeader>
          <p
            className={`text-2xl font-bold font-mono tabular-nums tracking-tight ${
              accent ? "text-primary" : ""
            }`}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
