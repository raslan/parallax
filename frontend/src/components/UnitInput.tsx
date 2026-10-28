import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Number field with its unit ("s", "%", "kbps") shown inside the right edge, so
 * the value never reads as a bare number. Size it with `className` (e.g. `w-24`).
 */
export function UnitInput({
  unit,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  unit: string;
  className?: string;
}) {
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <input
        type="number"
        {...props}
        className="w-full rounded-md border border-border bg-muted py-1 pl-2 pr-8 text-sm tabular-nums text-foreground disabled:cursor-not-allowed"
      />
      <span className="pointer-events-none absolute right-2 text-2xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}
