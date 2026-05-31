import { useState, useEffect, useMemo } from "react";
import { Scissors, Loader2, Trash2, Search, Play, LayoutGrid, List, ImageOff, Check, ArrowUp, ArrowDown, Brain, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, CleanupParams, Library, VideoFile, VideoSearchResult } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { formatSize, formatDuration, formatUnixDate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

const NUDENET_GROUPS = [
  { label: "Exposed", labels: ["FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED"] },
  { label: "Covered", labels: ["FEMALE_BREAST_COVERED", "FEMALE_GENITALIA_COVERED", "MALE_GENITALIA_COVERED", "BUTTOCKS_COVERED"] },
  { label: "Other",   labels: ["BELLY_EXPOSED", "ARMPITS_EXPOSED", "FEET_EXPOSED"] },
];

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

function FilterAccordion({
  label,
  summary,
  enabled,
  onToggle,
  badge,
  children,
}: {
  label: string;
  summary: string | null;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(enabled);

  useEffect(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <input
          type="checkbox"
          className="accent-primary h-4 w-4 shrink-0"
          checked={enabled}
          onChange={(e) => { e.stopPropagation(); onToggle(e.target.checked); }}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-sm font-medium flex-1">{label}</span>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            {badge}
          </span>
        )}
        {summary && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{summary}</span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-muted/20">
          {children}
        </div>
      )}
    </div>
  );
}

function CleanupCard({
  file,
  isSelected,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  isSelected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <Card
      className={`overflow-hidden cursor-pointer group transition-shadow hover:ring-1 ${isSelected ? "ring-1 ring-primary" : "hover:ring-primary/60"}`}
      onClick={onToggle}
    >
      <div className="aspect-video bg-muted relative flex items-center justify-center">
        {file.has_thumbnail && !imgError ? (
          <img
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.filename}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-8 w-8 text-muted-foreground/40" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          title="Toggle selection"
          className={`absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded border-2 flex items-center justify-center transition-opacity ${isSelected ? "opacity-100 bg-primary border-primary" : "opacity-0 group-hover:opacity-100 bg-black/50 border-white/70"}`}
        >
          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          title="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
        >
          <Play className="h-8 w-8 text-white fill-white" />
        </button>
      </div>
      <CardContent className="p-2.5 space-y-0.5">
        <p className="text-xs font-medium truncate" title={file.filename}>{file.filename}</p>
        <p className="text-xs text-muted-foreground">
          {file.file_width && file.file_height ? <span className="font-mono">{file.file_width}×{file.file_height}</span> : null}
          {file.file_width && file.file_height ? " · " : ""}
          <span className="font-mono">{formatDuration(file.duration)}</span>
          {" · "}<span className="font-mono">{formatSize(file.size)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

export function Cleanup() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Standard filters
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

  // Filename filter
  const [filenameEnabled, setFilenameEnabled]       = useState(false);
  const [filenameQuery, setFilenameQuery]           = useState("");
  const [filenameExclude, setFilenameExclude]       = useState(false);
  const [filenameFuzzy, setFilenameFuzzy]           = useState(false);
  const [filenameThreshold, setFilenameThreshold]   = useState(0.4);

  // AI filters
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipQuery, setClipQuery] = useState("");
  const [clipMinScore, setClipMinScore] = useState(0.25);
  const [clipExclude, setClipExclude] = useState(false);

  const [nudenetEnabled, setNudenetEnabled] = useState(false);
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set());
  const [detectionConfidence, setDetectionConfidence] = useState(0.5);
  const [nudenetExclude, setNudenetExclude] = useState(false);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<VideoFile[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortBy, setSortBy] = useState("filename");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setSelectedId(libs[0].id);
    });
  }, []);

  const anyStandardFilterEnabled = durationEnabled || fpsEnabled || dateEnabled || heightEnabled;
  const clipActive = clipEnabled && clipQuery.trim().length > 0;
  const nudenetActive = nudenetEnabled && checkedLabels.size > 0;
  const filenameActive = filenameEnabled && filenameQuery.trim().length > 0;
  const anyServerFilterActive = anyStandardFilterEnabled || clipActive || nudenetActive;
  const anyFilterActive = anyServerFilterActive || filenameActive;

  const SORT_OPTIONS = [
    { value: "filename",      label: "Name" },
    { value: "size",          label: "Size" },
    { value: "duration",      label: "Duration" },
    { value: "video_bitrate", label: "Bitrate" },
    { value: "file_date",     label: "File date" },
  ] as const;

  const sortedResults = useMemo(() => {
    if (!results) return null;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      const av = (a as any)[sortBy] ?? "";
      const bv = (b as any)[sortBy] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [results, sortBy, sortDir]);

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

  const toggleLabel = (label: string) => {
    setCheckedLabels((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const bigramSimilarity = (a: string, b: string): number => {
    const s = a.toLowerCase();
    const t = b.toLowerCase();
    if (t.length === 0) return 1;
    if (s.length < 2 || t.length < 2) return s.includes(t) ? 1 : 0;
    const bigrams = (str: string) => {
      const set = new Map<string, number>();
      for (let i = 0; i < str.length - 1; i++) {
        const bg = str.slice(i, i + 2);
        set.set(bg, (set.get(bg) ?? 0) + 1);
      }
      return set;
    };
    const sa = bigrams(s);
    const tb = bigrams(t);
    let intersection = 0;
    for (const [bg, cnt] of tb) intersection += Math.min(cnt, sa.get(bg) ?? 0);
    return (2 * intersection) / (s.length - 1 + t.length - 1);
  };

  const matchesFilename = (filename: string): boolean => {
    const q = filenameQuery.trim().toLowerCase();
    const name = filename.toLowerCase();
    const matches = filenameFuzzy
      ? bigramSimilarity(name, q) >= filenameThreshold
      : name.includes(q);
    return filenameExclude ? !matches : matches;
  };

  const handleFind = async () => {
    if (!selectedId || !anyFilterActive) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(new Set());
    try {
      const fileMap = new Map<number, VideoFile>();
      const idSets: Set<number>[] = [];
      const tasks: Promise<void>[] = [];

      if (anyStandardFilterEnabled) {
        tasks.push(
          api.getCleanupFiles(selectedId, buildParams()).then((files) => {
            files.forEach((f) => fileMap.set(f.id, f));
            idSets.push(new Set(files.map((f) => f.id)));
          })
        );
      }

      if (clipActive) {
        tasks.push(
          api.searchFiles(clipQuery.trim(), selectedId, 10000).then((results: VideoSearchResult[]) => {
            const filtered = results.filter((r) => clipExclude ? r.score < clipMinScore : r.score >= clipMinScore);
            filtered.forEach((r) => fileMap.set(r.file.id, r.file));
            idSets.push(new Set(filtered.map((r) => r.file.id)));
          })
        );
      }

      if (nudenetActive) {
        tasks.push(
          api.filterFilesByDetections({
            labels: [...checkedLabels],
            min_confidence: detectionConfidence,
            exclude: nudenetExclude,
            library_id: selectedId,
            page_size: 10000,
          }).then((res) => {
            res.items.forEach((f) => fileMap.set(f.id, f));
            idSets.push(new Set(res.items.map((f) => f.id)));
          })
        );
      }

      // If filename is the only active filter, fetch all files as the base universe
      if (filenameActive && !anyServerFilterActive) {
        tasks.push(
          api.getCleanupFiles(selectedId, {}, true).then((files) => {
            files.forEach((f) => fileMap.set(f.id, f));
            idSets.push(new Set(files.map((f) => f.id)));
          })
        );
      }

      await Promise.all(tasks);

      // Intersect all server-side filter results
      let intersected = idSets[0] ?? new Set<number>();
      for (const s of idSets.slice(1)) {
        intersected = new Set([...intersected].filter((id) => s.has(id)));
      }

      // Apply filename filter client-side
      let finalFiles = [...intersected].map((id) => fileMap.get(id)!);
      if (filenameActive) {
        finalFiles = finalFiles.filter((f) => matchesFilename(f.filename));
      }

      setResults(finalFiles);
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
          <SectionHeader className="mb-1.5">Library maintenance</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stack filters to find files matching all conditions, then bulk-delete matches.
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
            disabled={!anyFilterActive || !selectedId || loading}
          >
            {loading
              ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Searching…</>
              : <><Search className="h-3.5 w-3.5 mr-2" />Find Files</>
            }
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {/* Duration */}
        <FilterAccordion
          label="Duration"
          summary={durationEnabled ? `${durationOp === "lt" ? "shorter than" : "longer than"} ${durationH}h ${durationM}m ${durationS}s` : null}
          enabled={durationEnabled}
          onToggle={setDurationEnabled}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <OpSelect
              value={durationOp}
              onChange={(v) => setDurationOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "Shorter than" }, { value: "gt", label: "Longer than" }]}
              disabled={false}
            />
            <div className="flex items-center gap-1.5">
              <NumInput value={durationH} onChange={setDurationH} max={99} disabled={false} />
              <span className="text-xs text-muted-foreground">h</span>
              <NumInput value={durationM} onChange={setDurationM} max={59} disabled={false} />
              <span className="text-xs text-muted-foreground">m</span>
              <NumInput value={durationS} onChange={setDurationS} max={59} disabled={false} />
              <span className="text-xs text-muted-foreground">s</span>
            </div>
          </div>
        </FilterAccordion>

        {/* Frame rate */}
        <FilterAccordion
          label="Frame rate"
          summary={fpsEnabled ? `${fpsOp === "lt" ? "below" : "above"} ${fpsVal} fps` : null}
          enabled={fpsEnabled}
          onToggle={setFpsEnabled}
        >
          <div className="flex items-center gap-3">
            <OpSelect
              value={fpsOp}
              onChange={(v) => setFpsOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "Below" }, { value: "gt", label: "Above" }]}
              disabled={false}
            />
            <NumInput value={fpsVal} onChange={setFpsVal} min={1} max={240} step={1} disabled={false} />
            <span className="text-xs text-muted-foreground">fps</span>
          </div>
        </FilterAccordion>

        {/* File date */}
        <FilterAccordion
          label="File date"
          summary={dateEnabled ? `${dateOp === "before" ? "older than" : "newer than"} ${dateN} ${dateUnit}` : null}
          enabled={dateEnabled}
          onToggle={setDateEnabled}
        >
          <div className="flex items-center gap-3">
            <OpSelect
              value={dateOp}
              onChange={(v) => setDateOp(v as "before" | "after")}
              options={[{ value: "before", label: "Older than" }, { value: "after", label: "Newer than" }]}
              disabled={false}
            />
            <NumInput value={dateN} onChange={setDateN} min={1} max={3650} disabled={false} className="w-16" />
            <OpSelect
              value={dateUnit}
              onChange={(v) => setDateUnit(v as "days" | "weeks" | "months")}
              options={[{ value: "days", label: "days" }, { value: "weeks", label: "weeks" }, { value: "months", label: "months" }]}
              disabled={false}
            />
          </div>
        </FilterAccordion>

        {/* Resolution */}
        <FilterAccordion
          label="Resolution"
          summary={heightEnabled ? `${heightOp === "lt" ? "below" : "above"} ${heightVal}px height` : null}
          enabled={heightEnabled}
          onToggle={setHeightEnabled}
        >
          <div className="flex items-center gap-3">
            <OpSelect
              value={heightOp}
              onChange={(v) => setHeightOp(v as "lt" | "gt")}
              options={[{ value: "lt", label: "Below" }, { value: "gt", label: "Above" }]}
              disabled={false}
            />
            <NumInput value={heightVal} onChange={setHeightVal} min={1} max={9999} disabled={false} className="w-20" />
            <span className="text-xs text-muted-foreground">px height</span>
          </div>
        </FilterAccordion>

        {/* Filename */}
        <FilterAccordion
          label="Filename"
          summary={filenameActive ? `${filenameExclude ? "not " : ""}${filenameFuzzy ? `~${Math.round(filenameThreshold * 100)}% ` : ""}contains "${filenameQuery}"` : null}
          enabled={filenameEnabled}
          onToggle={setFilenameEnabled}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <select
                className="bg-card border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={filenameExclude ? "exclude" : "include"}
                onChange={(e) => setFilenameExclude(e.target.value === "exclude")}
              >
                <option value="include">Contains</option>
                <option value="exclude">Does not contain</option>
              </select>
              <input
                type="text"
                value={filenameQuery}
                onChange={(e) => setFilenameQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFind()}
                placeholder="e.g. sample, 720p, copy…"
                className="flex-1 max-w-xs h-8 rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={filenameFuzzy}
                onChange={(e) => setFilenameFuzzy(e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="text-xs text-muted-foreground">Fuzzy match</span>
            </label>
            {filenameFuzzy && (
              <div className="flex items-center gap-3 pl-5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Similarity threshold</span>
                <input
                  type="range" min="0.1" max="1" step="0.05"
                  value={filenameThreshold}
                  onChange={(e) => setFilenameThreshold(Number(e.target.value))}
                  className="w-36 accent-primary"
                />
                <span className="text-xs font-mono text-muted-foreground w-8">{Math.round(filenameThreshold * 100)}%</span>
              </div>
            )}
          </div>
        </FilterAccordion>

        {/* Semantic search */}
        <FilterAccordion
          label="Semantic search"
          badge="AI"
          summary={clipEnabled && clipQuery ? `${clipExclude ? "NOT " : ""}"${clipQuery}"${!clipExclude ? ` · ≥${Math.round(clipMinScore * 100)}%` : ""}` : null}
          enabled={clipEnabled}
          onToggle={setClipEnabled}
        >
          <div className="space-y-3">
            <input
              type="text"
              value={clipQuery}
              onChange={(e) => setClipQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFind()}
              placeholder="e.g. beach sunset, people dancing…"
              className="w-full max-w-md h-8 rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Min similarity score</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={clipMinScore}
                onChange={(e) => setClipMinScore(Number(e.target.value))}
                disabled={clipExclude}
                className="w-36 accent-primary disabled:opacity-40"
              />
              <span className="text-xs font-mono text-muted-foreground w-8">{Math.round(clipMinScore * 100)}%</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={clipExclude}
                onChange={(e) => setClipExclude(e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="text-xs text-muted-foreground">Exclude matches — find files that do <em>not</em> match this query</span>
            </label>
          </div>
        </FilterAccordion>

        {/* Content detection */}
        <FilterAccordion
          label="Content detection"
          badge="AI"
          summary={nudenetEnabled && checkedLabels.size > 0 ? `${nudenetExclude ? "NOT " : ""}${checkedLabels.size} label${checkedLabels.size !== 1 ? "s" : ""} · ≥${Math.round(detectionConfidence * 100)}%` : null}
          enabled={nudenetEnabled}
          onToggle={setNudenetEnabled}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              {NUDENET_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.labels.map((label) => (
                      <button
                        key={label}
                        onClick={() => toggleLabel(label)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          checkedLabels.has(label)
                            ? "bg-primary/10 border-primary text-primary"
                            : "border-border text-muted-foreground hover:border-foreground/40"
                        }`}
                      >
                        {label.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Min confidence</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={detectionConfidence}
                onChange={(e) => setDetectionConfidence(Number(e.target.value))}
                className="w-36 accent-primary"
              />
              <span className="text-xs font-mono text-muted-foreground w-8">{Math.round(detectionConfidence * 100)}%</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={nudenetExclude}
                onChange={(e) => setNudenetExclude(e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="text-xs text-muted-foreground">Invert — find files that do <em>not</em> contain these detections</span>
            </label>
          </div>
        </FilterAccordion>
      </div>

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
              Enable one or more filters and click Find Files. All active filters stack — results must match every condition.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && sortedResults !== null && sortedResults.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No files match</h3>
            <p className="text-sm text-muted-foreground">Try adjusting the filters.</p>
          </CardContent>
        </Card>
      )}

      {!loading && sortedResults !== null && sortedResults.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums font-mono">{sortedResults.length}</span> file{sortedResults.length !== 1 ? "s" : ""} match
            </p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary h-4 w-4"
                  checked={selected.size === sortedResults.length && sortedResults.length > 0}
                  onChange={toggleAll}
                />
                Select all
              </label>
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
                className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={sortDir === "asc" ? "Ascending" : "Descending"}
              >
                {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </button>
              <div className="flex items-center rounded-md border border-input overflow-hidden">
                <button
                  onClick={() => setViewMode("list")}
                  className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                  title="List view"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                  title="Grid view"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </div>
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

          {viewMode === "list" ? (
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
                  {sortedResults.map((f) => (
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
                        <button
                          className="relative group/thumb h-8 w-14 shrink-0"
                          onClick={(e) => { e.stopPropagation(); setPlayingFile(f); }}
                          title="Play video"
                        >
                          {f.has_thumbnail ? (
                            <img
                              src={`/api/files/${f.id}/thumbnail`}
                              alt={f.filename}
                              className="h-8 w-14 object-cover rounded"
                            />
                          ) : (
                            <div className="h-8 w-14 bg-muted rounded" />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                            <Play className="h-3.5 w-3.5 text-white fill-white" />
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        <p className="truncate font-medium" title={f.filename}>{f.filename}</p>
                        <p className="truncate text-xs text-muted-foreground" title={f.path}>{f.path}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-mono">
                        {f.file_width && f.file_height ? `${f.file_width}×${f.file_height}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-mono">
                        {f.file_fps != null ? f.file_fps.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-mono">
                        {formatDuration(f.duration)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground font-mono">
                        {formatUnixDate(f.file_date)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-mono">
                        {formatSize(f.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {sortedResults.map((f) => (
                <CleanupCard
                  key={f.id}
                  file={f}
                  isSelected={selected.has(f.id)}
                  onToggle={() => toggleOne(f.id)}
                  onPlay={() => setPlayingFile(f)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleUrl={api.subtitleUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
