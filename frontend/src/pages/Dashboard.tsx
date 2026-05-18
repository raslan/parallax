import { useEffect, useState } from "react";
import { Library, Film, AlertTriangle, CheckCircle2, HardDrive, Loader2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api, Stats } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { ParallaxLogo } from "@/components/ParallaxLogo";
import { SectionHeader } from "@/components/SectionHeader";
import { StatPanel } from "@/components/StatPanel";
import { StatusDot } from "@/components/StatusDot";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () =>
      api.getStats()
        .then((s) => { setStats(s); setLoaded(true); })
        .catch(() => setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const hasCorrupt = (stats?.corrupt_files ?? 0) > 0;
  const healthPct  = stats && stats.total_files > 0
    ? Math.round(((stats.total_files - stats.corrupt_files) / stats.total_files) * 100)
    : 100;

  if (!loaded && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loaded && stats?.total_libraries === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <ParallaxLogo className="h-14 w-14 mb-1" />
        <h2 className="text-lg font-semibold tracking-tight">No libraries yet</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Add a library to start scanning your media folders for corrupt video files.
        </p>
        <Link
          to="/libraries"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Add your first library <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div
        className={`h-px w-full shrink-0 ${stats?.scanning ? "animate-pulse" : ""}`}
        style={{ background: "linear-gradient(90deg, var(--px-accent), var(--px-accent) 40%, transparent 85%)" }}
      />

      <div className="flex-1 p-10 space-y-6">

        <div className="flex items-start justify-between">
          <div>
            <SectionHeader className="mb-1.5">System status</SectionHeader>
            <h1 className="text-2xl font-semibold tracking-tight">
              {hasCorrupt
                ? <><span className="text-red-400">{stats!.corrupt_files} {stats!.corrupt_files === 1 ? "file" : "files"}</span> need repair</>
                : "All files healthy"}
            </h1>
          </div>

          {stats?.scanning && (
            <div className="pt-0.5">
              <StatusDot status="scanning" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 border border-border rounded-[0.4rem] overflow-hidden divide-x divide-border">
          {[
            { label: "Libraries",   value: stats?.total_libraries  ?? 0, icon: Library,      fmt: (n: number) => String(n),          },
            { label: "Total files", value: stats?.total_files      ?? 0, icon: Film,          fmt: (n: number) => n.toLocaleString(), },
            { label: "Corrupt",     value: stats?.corrupt_files    ?? 0, icon: AlertTriangle, fmt: (n: number) => String(n), corrupt: true },
            { label: "Repaired",    value: stats?.transcoded_files ?? 0, icon: CheckCircle2,  fmt: (n: number) => String(n), good: true    },
          ].map(({ label, value, icon: Icon, fmt, corrupt, good }) => {
            const isRed   = corrupt && value > 0;
            const isGreen = good    && value > 0;
            return (
              <div key={label} className={`px-7 py-6 ${isRed ? "bg-red-950/20" : ""}`}>
                <SectionHeader className="mb-4">{label}</SectionHeader>
                <div className={`text-4xl font-bold tabular-nums tracking-tight font-mono ${
                  isRed ? "text-red-400" : isGreen ? "text-primary" : "text-foreground"
                }`}>
                  {fmt(value)}
                </div>
                <Icon className={`h-3.5 w-3.5 mt-3 ${
                  isRed ? "text-red-400/40" : isGreen ? "text-primary/40" : "text-muted-foreground/30"
                }`} />
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatPanel className="col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <SectionHeader>Library health</SectionHeader>
              <span className={`text-sm font-semibold tabular-nums font-mono ${hasCorrupt ? "text-red-400" : "text-primary"}`}>
                {stats?.total_files === 0 ? "—" : `${healthPct}%`}
              </span>
            </div>

            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--px-bg-elevated)" }}>
              <div
                className="h-full rounded-l-full transition-all duration-700"
                style={{
                  width: `${healthPct}%`,
                  background: hasCorrupt
                    ? "rgba(248,113,113,0.7)"
                    : "linear-gradient(90deg, var(--px-accent), var(--px-accent-secondary))",
                }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{stats ? (stats.total_files - stats.corrupt_files).toLocaleString() : 0} clean</span>
              {hasCorrupt && <span className="text-red-400/80">{stats?.corrupt_files} corrupt</span>}
            </div>
          </StatPanel>

          <StatPanel className="flex flex-col justify-between">
            <SectionHeader className="mb-4">Storage tracked</SectionHeader>
            <div className="text-2xl font-bold tabular-nums tracking-tight font-mono">
              {stats && stats.total_size_bytes > 0 ? formatSize(stats.total_size_bytes) : "—"}
            </div>
            <HardDrive className="h-3.5 w-3.5 mt-3 text-muted-foreground/30" />
          </StatPanel>
        </div>

        {hasCorrupt && (
          <div className="border border-red-900/50 bg-red-950/10 rounded-[0.4rem] px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm">
                <span className="font-medium text-red-400">
                  {stats!.corrupt_files} {stats!.corrupt_files === 1 ? "file" : "files"}
                </span>
                <span className="text-muted-foreground ml-1.5">detected as corrupt — ready to transcode</span>
              </p>
            </div>
            <Link
              to="/libraries"
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors shrink-0 ml-6"
            >
              Fix now <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {error && <p className="text-sm text-destructive">Could not reach the API.</p>}

      </div>
    </div>
  );
}
