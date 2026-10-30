import { cn } from "@/lib/utils";

/**
 * The app's one progress bar. `value` 0–100 is determinate; `null` is
 * indeterminate (a shimmer sweep). The fill is scaled with a transform rather
 * than a width transition, per the animation rules in `frontend/CLAUDE.md`.
 */
export function ProgressBar({
  value,
  label = "Progress",
  className,
  barClassName,
}: {
  value: number | null;
  label?: string;
  /** Applied to the track — override the height (`h-1`) or add width/margin. */
  className?: string;
  /** Applied to the fill — override the colour (`bg-white/70`). */
  barClassName?: string;
}) {
  const pct = value == null ? null : Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct == null ? undefined : Math.round(pct)}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {pct == null ? (
        <div
          className={cn(
            "absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-primary to-transparent",
            barClassName,
          )}
        />
      ) : (
        <div
          className={cn(
            "h-full w-full origin-left bg-primary transition-transform duration-300",
            barClassName,
          )}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      )}
    </div>
  );
}
