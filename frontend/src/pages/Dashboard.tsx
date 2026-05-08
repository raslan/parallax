import { useEffect, useState } from "react";
import { Library, Film, AlertTriangle, CheckCircle, HardDrive, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, Stats } from "@/lib/api";
import { formatSize } from "@/lib/format";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = () =>
      api.getStats().then(setStats).catch(() => setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const cards = [
    {
      label: "Libraries",
      value: stats ? String(stats.total_libraries) : "—",
      icon: Library,
      description: "Managed libraries",
    },
    {
      label: "Total Files",
      value: stats ? stats.total_files.toLocaleString() : "—",
      icon: Film,
      description: "Video files tracked",
    },
    {
      label: "Corrupt",
      value: stats ? String(stats.corrupt_files) : "—",
      icon: AlertTriangle,
      description: "Files needing repair",
      highlight: stats && stats.corrupt_files > 0,
    },
    {
      label: "Transcoded",
      value: stats ? String(stats.transcoded_files) : "—",
      icon: CheckCircle,
      description: "Successfully fixed",
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of your libraries and transcoding activity.
          </p>
        </div>
        {stats?.scanning && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning…
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">Could not reach the API.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, description, highlight }) => (
          <Card key={label} className={highlight ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {label}
                </CardTitle>
                <Icon
                  className={`h-4 w-4 ${highlight ? "text-destructive" : "text-muted-foreground"}`}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${highlight ? "text-destructive" : ""}`}>
                {value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats && stats.total_size_bytes > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total storage tracked
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatSize(stats.total_size_bytes)}</div>
          </CardContent>
        </Card>
      )}

      {stats && stats.total_libraries === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Library className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No libraries yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add a library to start scanning your media folders for corrupt video files.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
