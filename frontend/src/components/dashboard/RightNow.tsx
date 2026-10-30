import { Link } from "react-router";
import { ProgressBar } from "@/components/ProgressBar";
import { RelativeTime } from "@/components/RelativeTime";
import { StatusDot } from "@/components/StatusDot";
import { jobLabel } from "@/lib/jobs";
import type { Job } from "@/types/job";

export interface LibraryCount {
  label: string;
  count: number;
  to: string;
}

const DOT = {
  completed: "done",
  failed: "error",
  cancelled: "idle",
} as const;

/** What is running now, what just finished, and which libraries are loaded. */
export function RightNow({
  active,
  recent,
  libraries,
}: {
  active: readonly Job[];
  recent: readonly Job[];
  libraries: readonly LibraryCount[];
}) {
  const loaded = libraries.filter((l) => l.count > 0);
  return (
    <div className="space-y-5">
      {active.length > 0 ? (
        <ul className="space-y-3">
          {active.map((j) => (
            <li key={j.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <Link to={`/jobs?focus=${j.id}`} className="hover:underline">
                  {jobLabel(j.type)}
                </Link>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {j.status === "pending" ? "queued" : `${Math.round(j.progress)}%`}
                </span>
              </div>
              <ProgressBar
                value={j.status === "pending" ? 0 : j.progress}
                label={`${jobLabel(j.type)} progress`}
                className="mt-1.5"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing is running.</p>
      )}

      {recent.length > 0 && (
        <ul className="space-y-2 border-t border-border pt-4">
          {recent.map((j) => (
            <li key={j.id} className="flex items-center gap-2 text-sm">
              <StatusDot status={DOT[j.status as keyof typeof DOT] ?? "idle"} />
              <span className="flex-1 truncate">{jobLabel(j.type)}</span>
              <RelativeTime
                iso={j.finished_at ?? j.created_at}
                className="text-xs text-muted-foreground"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
        {loaded.length > 0 ? (
          <p className="text-muted-foreground">
            Loaded:{" "}
            {loaded.map((l, i) => (
              <span key={l.to}>
                {i > 0 && ", "}
                <Link to={l.to} className="text-foreground hover:underline">
                  {l.count} {l.label}
                </Link>
              </span>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">No libraries are loaded.</p>
        )}
        <Link to="/jobs" className="text-primary hover:underline">
          All jobs
        </Link>
      </div>
    </div>
  );
}
