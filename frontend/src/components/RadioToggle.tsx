import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Pill-style single choice. `hint` renders as an "i" tooltip on the right of the option, not inline
 * copy; `detail` is a short muted tag after the label (e.g. "Fast"); a `disabled` option stays
 * visible but can't be picked. Must sit inside a `TooltipProvider` when any option has a hint.
 */
export function RadioToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; hint?: string; detail?: string; disabled?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={opt.disabled}
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
              opt.disabled && "cursor-not-allowed opacity-40 hover:border-border",
            )}
          >
            <span
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors",
                active ? "border-primary bg-primary" : "border-muted-foreground/40",
              )}
            />
            <span className="font-medium">{opt.label}</span>
            {opt.detail && <span className="text-2xs text-muted-foreground/60">{opt.detail}</span>}
            {opt.hint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  {opt.hint}
                </TooltipContent>
              </Tooltip>
            )}
          </button>
        );
      })}
    </div>
  );
}
