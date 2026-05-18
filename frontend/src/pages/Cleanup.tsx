import { useState } from "react";
import { Scissors, Loader2, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, CleanupParams, Library, VideoFile } from "@/lib/api";
import { formatSize, formatDuration, formatUnixDate } from "@/lib/format";

function LibrarySelector({
  libraries,
  selected,
  onChange,
}: {
  libraries: Library[];
  selected: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select
      className="bg-card border border-border text-sm rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      value={selected ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {libraries.map((lib) => (
        <option key={lib.id} value={lib.id}>{lib.name}</option>
      ))}
    </select>
  );
}

function OpSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled: boolean;
}) {
  return (
    <select
      className="bg-card border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  className?: string;
}) {
  return (
    <input
      type="number"
      className={`bg-card border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 w-16 tabular-nums ${className ?? ""}`}
      value={value}
      min={min ?? 0}
      max={max}
      step={step ?? 1}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Cleanup() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [durationEnabled, setDurationEnabled] = useState(false);
  const [durationOp, setDurationOp] = useState<"lt" | "gt">("lt");
  const [durationH, setDurationH] = useState(0);
  const [durationM, setDurationM] = useState(0);
  const [durationS, setDurationS] = useState(30);

  const [fpsEnabled, setFpsEnabled] = useState(false);
  const [fpsOp, setFpsOp] = useState<"lt" | "gt">("lt");
  const [fpsVal, setFpsVal] = useState(24);

  const [dateEnabled, setDateEnabled] = useState(false);
  const [dateOp, setDateOp] = useState<"before" | "after">("before");
  const [dateN, setDateN] = useState(30);
  const [dateUnit, setDateUnit] = useState<"days" | "weeks" | "months">("days");

  const [heightEnabled, setHeightEnabled] = useState(false);
  const [heightOp, setHeightOp] = useState<"lt" | "gt">("lt");
  const [heightVal, setHeightVal] = useState(480);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<VideoFile[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setSelectedId(libs[0].id);
    });
  });

  const anyFilterEnabled = durationEnabled || fpsEnabled || dateEnabled || heightEnabled;

  const buildParams = (): CleanupParams => {
    const params: CleanupParams = {};
    if (durationEnabled) {
      params.duration_op = durationOp;
      params.duration_secs = durationH * 3600 + durationM * 60 + durationS;
    }
    if (fpsEnabled) {
      params.fps_op = fpsOp;
      params.fps_val = fpsVal;
    }
    if (dateEnabled) {
      const multiplier = { days: 86400, weeks: 604800, months: 2592000 }[dateUnit];
      params.date_op = dateOp;
      params.date_ts = Date.now() / 1000 - dateN * multiplier;
    }
    if (heightEnabled) {
      params.height_op = heightOp;
      params.height_val = heightVal;
    }
    return params;
  };

  const handleFind = async () => {
    if (!selectedId || !anyFilterEnabled) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(new Set());
    try {
      const files = await api.getCleanupFiles(selectedId, buildParams());
      setResults(files);
    } catch (e: any) {
      setError(e.message || "Failed to fetch results");
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    if (!results) return;
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((f) => f.id)));
    }
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!selectedId || selected.size === 0 || !results) return;
    if (!confirm(`Move ${selected.size} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    try {
      await api.deleteCleanupFiles(selectedId, [...selected]);
      const remaining = results.filter((f) => !selected.has(f.id));
      setResults(remaining);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filter library files by duration, frame rate, date, or resolution and bulk-delete matches.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {libraries.length > 0 && (
            <LibrarySelector
              libraries={libraries}
              selected={selectedId}
              onChange={(id) => { setSelectedId(id); setResults(null); setSelected(new Set()); }}
            />
          )}
          <Button
            onClick={handleFind}
            disabled={!anyFilterEnabled || !selectedId || loading}
          >
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Searching…</>
              : <><Search className="h-3.5 w-3.5 mr-2" />Find Files</>
            }
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className={`flex items-center gap-3 ${!durationEnabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={durationEnabled} onChange={(e) => setDurationEnabled(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm w-24 shrink-0">Duration</span>
            <OpSelect
              value={durationOp}
              onChange={(v) => setDurationOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "shorter than" }, { value: "gt", label: "longer than" }]}
              disabled={!durationEnabled}
            />
            <div className="flex items-center gap-1">
              <NumInput value={durationH} onChange={setDurationH} max={99} disabled={!durationEnabled} />
              <span className="text-xs text-muted-foreground">h</span>
              <NumInput value={durationM} onChange={setDurationM} max={59} disabled={!durationEnabled} />
              <span className="text-xs text-muted-foreground">m</span>
              <NumInput value={durationS} onChange={setDurationS} max={59} disabled={!durationEnabled} />
              <span className="text-xs text-muted-foreground">s</span>
            </div>
          </div>

          <div className={`flex items-center gap-3 ${!fpsEnabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={fpsEnabled} onChange={(e) => setFpsEnabled(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm w-24 shrink-0">Frame rate</span>
            <OpSelect
              value={fpsOp}
              onChange={(v) => setFpsOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "below" }, { value: "gt", label: "above" }]}
              disabled={!fpsEnabled}
            />
            <div className="flex items-center gap-1.5">
              <NumInput value={fpsVal} onChange={setFpsVal} min={1} max={240} step={1} disabled={!fpsEnabled} />
              <span className="text-xs text-muted-foreground">fps</span>
            </div>
          </div>

          <div className={`flex items-center gap-3 ${!dateEnabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={dateEnabled} onChange={(e) => setDateEnabled(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm w-24 shrink-0">File date</span>
            <OpSelect
              value={dateOp}
              onChange={(v) => setDateOp(v as "before" | "after")}
              options={[{ value: "before", label: "older than" }, { value: "after", label: "newer than" }]}
              disabled={!dateEnabled}
            />
            <div className="flex items-center gap-1.5">
              <NumInput value={dateN} onChange={setDateN} min={1} max={3650} disabled={!dateEnabled} className="w-16" />
              <OpSelect
                value={dateUnit}
                onChange={(v) => setDateUnit(v as "days" | "weeks" | "months")}
                options={[
                  { value: "days", label: "days" },
                  { value: "weeks", label: "weeks" },
                  { value: "months", label: "months" },
                ]}
                disabled={!dateEnabled}
              />
            </div>
          </div>

          <div className={`flex items-center gap-3 ${!heightEnabled ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={heightEnabled} onChange={(e) => setHeightEnabled(e.target.checked)} className="accent-primary h-4 w-4" />
            <span className="text-sm w-24 shrink-0">Resolution</span>
            <OpSelect
              value={heightOp}
              onChange={(v) => setHeightOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "below" }, { value: "gt", label: "above" }]}
              disabled={!heightEnabled}
            />
            <div className="flex items-center gap-1.5">
              <NumInput value={heightVal} onChange={setHeightVal} min={1} max={9999} disabled={!heightEnabled} className="w-20" />
              <span className="text-xs text-muted-foreground">px height</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && results === null && !error && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">Ready to search</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Enable at least one filter and click Find Files.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && results !== null && results.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No files match</h3>
            <p className="text-sm text-muted-foreground">Try adjusting the filters.</p>
          </CardContent>
        </Card>
      )}

      {!loading && results !== null && results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{results.length}</span> file{results.length !== 1 ? "s" : ""} match
            </p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary h-4 w-4"
                  checked={selected.size === results.length && results.length > 0}
                  onChange={toggleAll}
                />
                Select all
              </label>
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0 || deleting}
                onClick={handleDelete}
              >
                {deleting
                  ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Deleting…</>
                  : <><Trash2 className="h-3.5 w-3.5 mr-2" />Delete Selected ({selected.size})</>
                }
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="w-8 px-3 py-2"></th>
                  <th className="w-10 px-2 py-2"></th>
                  <th className="px-3 py-2 text-left">Filename</th>
                  <th className="px-3 py-2 text-right">Resolution</th>
                  <th className="px-3 py-2 text-right">FPS</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2 text-right">File date</th>
                  <th className="px-3 py-2 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((f) => (
                  <tr
                    key={f.id}
                    className={`hover:bg-muted/20 cursor-pointer transition-colors ${selected.has(f.id) ? "bg-primary/5" : ""}`}
                    onClick={() => toggleOne(f.id)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="accent-primary h-4 w-4"
                        checked={selected.has(f.id)}
                        onChange={() => toggleOne(f.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {f.has_thumbnail ? (
                        <img
                          src={`/api/files/${f.id}/thumbnail`}
                          alt={f.filename}
                          className="h-8 w-14 object-cover rounded"
                        />
                      ) : (
                        <div className="h-8 w-14 bg-muted rounded" />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <p className="truncate font-medium" title={f.filename}>{f.filename}</p>
                      <p className="truncate text-xs text-muted-foreground" title={f.path}>{f.path}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {f.file_width && f.file_height ? `${f.file_width}×${f.file_height}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {f.file_fps != null ? f.file_fps.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatDuration(f.duration)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatUnixDate(f.file_date)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatSize(f.size)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
