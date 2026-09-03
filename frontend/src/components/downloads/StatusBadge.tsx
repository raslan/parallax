import { AlertTriangle, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import type { DownloadItem } from "@/types/download";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "text-muted-foreground", bg: "bg-muted/40", icon: Clock },
  running: { label: "Running", color: "text-primary", bg: "bg-primary/10", icon: Loader2 },
  completed: {
    label: "Done",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    icon: CheckCircle2,
  },
  failed: { label: "Failed", color: "text-red-400", bg: "bg-red-400/10", icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", bg: "bg-muted/20", icon: X },
} as const;

export function StatusBadge({ status }: { status: DownloadItem["status"] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide",
        cfg.color,
        cfg.bg,
      )}
    >
      <Icon className={cn("h-2.5 w-2.5 shrink-0", status === "running" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}
