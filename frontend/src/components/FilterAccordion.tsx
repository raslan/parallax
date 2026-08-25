import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export function FilterAccordion({
  label,
  summary,
  enabled,
  onToggle,
  badge,
  children,
}: {
  label: string;
  summary: string | null;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(enabled);

  useEffect(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <input
          type="checkbox"
          className="accent-primary h-4 w-4 shrink-0"
          checked={enabled}
          data-testid={`filter-${label.toLowerCase().replace(/\s+/g, "-")}`}
          onChange={(e) => {
            e.stopPropagation();
            onToggle(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-sm font-medium flex-1">{label}</span>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            {badge}
          </span>
        )}
        {summary && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{summary}</span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>
      {open && <div className="px-4 pb-4 pt-1 bg-muted/20">{children}</div>}
    </div>
  );
}
