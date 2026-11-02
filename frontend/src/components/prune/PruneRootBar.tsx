import { CheckCircle2, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionHeader } from "@/components/SectionHeader";
import { Tip } from "@/components/Tip";
import { Checkbox } from "@/components/ui/checkbox";
import { REDACTED_FOLDER } from "@/lib/pruneRedact";
import { cn } from "@/lib/utils";
import type { ScanState } from "@/types/prune";

/**
 * The strip across the top of Prune: the chosen root, its scan status and the
 * two root-level actions. Props-in/callbacks-out.
 */
export function PruneRootBar({
  root,
  scan,
  busy,
  onChangeFolder,
  onRescan,
  redact,
  onRedact,
}: {
  root: string;
  /** Demo mode: the path and every name are hidden. */
  redact: boolean;
  onRedact: (v: boolean) => void;
  scan: ScanState | undefined;
  /** A root save or scan start is in flight. */
  busy: boolean;
  onChangeFolder: () => void;
  onRescan: () => void;
}) {
  const running = busy || scan?.status === "running";
  const failed = !running && scan?.status === "error";
  const folders = scan?.folders_scanned ?? 0;

  return (
    <div className="relative overflow-hidden rounded-md border bg-px-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-100",
            running ? "border-primary/50 text-primary" : "text-muted-foreground",
          )}
          style={running ? { background: "var(--px-accent-dim)" } : undefined}
        >
          <FolderOpen className={cn("h-4 w-4", running && "animate-pulse")} />
        </div>

        <div className="min-w-0 flex-1 basis-64">
          <SectionHeader>Pruning</SectionHeader>
          <Tip label={redact ? REDACTED_FOLDER : root}>
            <p className="truncate font-mono text-sm">{redact ? REDACTED_FOLDER : root}</p>
          </Tip>
        </div>

        <div
          className="flex min-w-32 items-center gap-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {running ? (
            <span key="running" className="animate-fade-in tabular-nums">
              Scanning
              <span key={folders} className="mx-1 inline-block animate-pop text-foreground">
                {folders.toLocaleString()}
              </span>
              folders
            </span>
          ) : failed ? (
            <span
              key="failed"
              className="flex animate-fade-in items-center gap-1.5 text-destructive"
            >
              <TriangleAlert className="h-3.5 w-3.5" />
              Scan failed
            </span>
          ) : scan?.status === "done" ? (
            <span key="done" className="flex animate-fade-in items-center gap-1.5 tabular-nums">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              {folders.toLocaleString()} folders indexed
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Tip label="Hide every folder and file name and thumbnail, handy for demos">
            <label className="flex cursor-pointer items-center gap-2 pr-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Checkbox checked={redact} onCheckedChange={(v) => onRedact(v === true)} />
              Redact names
            </label>
          </Tip>
          <Tip label="Re-read the folder from disk">
            <Button size="sm" variant="outline" disabled={running} onClick={onRescan}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", running && "animate-spin")} />
              Rescan
            </Button>
          </Tip>
          <Tip label="Pick a different folder to prune">
            <Button size="sm" variant="outline" onClick={onChangeFolder}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Change folder
            </Button>
          </Tip>
        </div>
      </div>

      {/* Scan progress hugs the bottom edge and fades out when finished. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 transition-opacity duration-200",
          running ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!running}
      >
        <ProgressBar value={null} label="Scanning folder" className="h-0.5 rounded-none" />
      </div>
    </div>
  );
}
