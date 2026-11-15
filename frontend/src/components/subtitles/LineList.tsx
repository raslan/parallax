import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The lines of a subtitle: time and text, the one the player is on highlighted, a click seeks
 * the video there. Text comes from a provider, so it is only ever rendered as text.
 */
export function LineList({
  lines,
  currentTime,
  onSeek,
}: {
  lines: { start: number; text: string }[];
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  // The last line that has started; none before the first.
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.start ?? Infinity) <= currentTime) current = i;
    else break;
  }
  return (
    <ul className="divide-y divide-border/50 rounded-md border">
      {lines.map((l, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={i === current ? "true" : undefined}
            onClick={() => onSeek(l.start)}
            className={cn(
              "flex w-full items-baseline gap-3 px-2 py-1 text-left text-xs hover:bg-muted/50",
              i === current && "bg-primary/15",
            )}
          >
            <span className="w-14 shrink-0 font-mono tabular-nums text-muted-foreground">
              {formatDuration(l.start)}
            </span>
            <span className="min-w-0 break-words">{l.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
