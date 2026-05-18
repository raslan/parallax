type DotStatus = "scanning" | "running" | "idle" | "error" | "done";

const DOT_LABEL: Record<DotStatus, string> = {
  scanning: "Scanning",
  running:  "Running",
  idle:     "Idle",
  error:    "Error",
  done:     "Done",
};

export function StatusDot({ status }: { status: DotStatus }) {
  const isPulsing = status === "scanning" || status === "running";
  const isError   = status === "error";

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2 shrink-0">
        {isPulsing && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
            style={{ background: isError ? "#f87171" : "var(--px-accent)" }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{
            background: isError
              ? "#f87171"
              : status === "idle"
              ? "var(--px-text-muted)"
              : "var(--px-accent)",
          }}
        />
      </span>
      <span
        className="text-[10px] font-mono font-bold uppercase tracking-[0.1em]"
        style={{
          color: isError
            ? "#f87171"
            : status === "idle"
            ? "var(--px-text-muted)"
            : "var(--px-accent)",
        }}
      >
        {DOT_LABEL[status]}
      </span>
    </div>
  );
}
