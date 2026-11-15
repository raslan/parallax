import { memo, useEffect, useRef, type RefObject } from "react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** After the user scrolled the list by hand, the highlight stops pulling it back for this long. */
const USER_SCROLL_QUIET_MS = 3000;

interface Line {
  start: number;
  text: string;
}

const LineRow = memo(function LineRow({
  line,
  active,
  onSeek,
  userScrolledAt,
}: {
  line: Line;
  active: boolean;
  onSeek: (time: number) => void;
  userScrolledAt: RefObject<number>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active || Date.now() - userScrolledAt.current < USER_SCROLL_QUIET_MS) return;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active, userScrolledAt]);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSeek(line.start)}
        className={cn(
          "flex w-full items-baseline gap-3 px-2 py-1 text-left text-xs hover:bg-muted/50",
          active && "bg-primary/15",
        )}
      >
        <span className="w-14 shrink-0 font-mono tabular-nums text-muted-foreground">
          {formatDuration(line.start)}
        </span>
        <span className="min-w-0 break-words">{line.text}</span>
      </button>
    </li>
  );
});

/**
 * The lines of a subtitle: time and text, the current one (`current`, an index) highlighted and
 * kept in view while the video plays, a click seeks the video there. Text comes from a
 * provider, so it is only ever rendered as text. The list scrolls on its own so the caller's
 * verdict buttons never end up below it.
 */
export function LineList({
  lines,
  current,
  onSeek,
}: {
  lines: Line[];
  current: number;
  onSeek: (time: number) => void;
}) {
  const userScrolledAt = useRef(0);
  const noteUserScroll = () => {
    userScrolledAt.current = Date.now();
  };
  return (
    <ul
      className="max-h-48 divide-y divide-border/50 overflow-y-auto rounded-md border md:max-h-72"
      onWheel={noteUserScroll}
      onTouchMove={noteUserScroll}
    >
      {lines.map((l, i) => (
        <LineRow
          key={i}
          line={l}
          active={i === current}
          onSeek={onSeek}
          userScrolledAt={userScrolledAt}
        />
      ))}
    </ul>
  );
}
