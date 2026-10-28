import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative, parseServerDate } from "@/lib/format";

/**
 * A timestamp shown as "2 days ago" with the exact date and time in a tooltip.
 * Give it a server ISO string (`iso`) or Unix seconds (`unix`).
 */
export function RelativeTime({
  iso,
  unix,
  fallback = "Never",
  className,
}: {
  iso?: string | null;
  unix?: number | null;
  fallback?: string;
  className?: string;
}) {
  const date = iso ? parseServerDate(iso) : unix != null ? new Date(unix * 1000) : null;
  if (!date || Number.isNaN(date.getTime())) return <span className={className}>{fallback}</span>;
  // Own provider so the component also works outside the app shell (tests, popovers).
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={date.toISOString()} className={className}>
            {formatRelative(date)}
          </time>
        </TooltipTrigger>
        <TooltipContent>{date.toLocaleString()}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
