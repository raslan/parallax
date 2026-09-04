import { Activity } from "lucide-react";
import { CircularProgressbarWithChildren, buildStyles } from "react-circular-progressbar";
import { cn } from "@/lib/utils";

const RING_STYLES = buildStyles({
  pathColor: "var(--px-accent)",
  trailColor: "hsl(var(--border))",
  strokeLinecap: "round",
  pathTransitionDuration: 0.4,
});

/** @public */
export function JobRadialIcon({
  progress,
  count,
}: {
  progress: number | "pending" | null;
  count: number;
}) {
  const glyph = <Activity className="h-4 w-4 text-foreground" />;

  let body: React.ReactNode;
  if (progress === null) {
    body = <div className="flex h-6 w-6 items-center justify-center">{glyph}</div>;
  } else if (progress === "pending") {
    body = (
      <div data-testid="job-radial-spin" className="h-6 w-6 animate-[spin_1.6s_linear_infinite]">
        <CircularProgressbarWithChildren value={25} strokeWidth={12} styles={RING_STYLES}>
          {glyph}
        </CircularProgressbarWithChildren>
      </div>
    );
  } else {
    body = (
      <div className="h-6 w-6">
        <CircularProgressbarWithChildren value={progress} strokeWidth={12} styles={RING_STYLES}>
          {glyph}
        </CircularProgressbarWithChildren>
      </div>
    );
  }

  return (
    <span className="relative inline-flex">
      {body}
      {count > 0 && (
        <span
          key={count}
          data-testid="job-badge"
          className={cn(
            "absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center animate-pop",
            "rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground",
          )}
        >
          {count}
        </span>
      )}
    </span>
  );
}
