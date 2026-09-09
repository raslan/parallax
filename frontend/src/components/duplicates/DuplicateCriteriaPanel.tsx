import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PercentSlider } from "@/components/QueryBuilder";
import type { DuplicateCriteria } from "@/types/duplicate";
import { cn } from "@/lib/utils";

const CATEGORY_COLOR = { free: "#38bdf8", extraction: "#a78bfa" } as const;

type Patch = Partial<DuplicateCriteria>;

function ToleranceInput({
  value,
  onChange,
  unit,
  max = 3600,
}: {
  value: number;
  onChange: (v: number) => void;
  unit: string;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>±</span>
      <input
        type="number"
        min={0}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-16 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground tabular-nums"
      />
      <span>{unit}</span>
    </div>
  );
}

// pHash Hamming threshold (0-64, lower = stricter) shown as a similarity %.
const phashPct = (threshold: number) => Math.round((1 - threshold / 64) * 100);
const phashThreshold = (pct: number) => Math.round((1 - pct / 100) * 64);

type CritDef = {
  /** the `use_*` boolean flag on DuplicateCriteria */
  flag: keyof DuplicateCriteria;
  label: string;
  category: "free" | "extraction";
  /** short value text shown on the active chip (null = no params) */
  summary?: (c: DuplicateCriteria) => string | null;
  /** popover editor body (omit for a params-less criterion) */
  editor?: (c: DuplicateCriteria, onChange: (p: Patch) => void) => React.ReactNode;
  /** one-liner shown in the editor + add menu */
  hint: string;
};

const CRITERIA: CritDef[] = [
  {
    flag: "use_size",
    label: "Exact size",
    category: "free",
    hint: "Files must share the same byte size.",
  },
  {
    flag: "use_duration",
    label: "Duration",
    category: "free",
    hint: "Group files with near-equal runtime.",
    summary: (c) => `±${c.duration_tolerance}s`,
    editor: (c, onChange) => (
      <ToleranceInput
        value={c.duration_tolerance}
        onChange={(v) => onChange({ duration_tolerance: v })}
        unit="seconds"
      />
    ),
  },
  {
    flag: "use_resolution",
    label: "Resolution",
    category: "free",
    hint: "Exact width × height match.",
  },
  {
    flag: "use_content_date",
    label: "Content date",
    category: "free",
    hint: "Group files shot within a window of each other.",
    summary: (c) => `±${Math.round(c.content_date_tolerance / 86400)}d`,
    editor: (c, onChange) => (
      <ToleranceInput
        value={c.content_date_tolerance / 86400}
        onChange={(v) => onChange({ content_date_tolerance: v * 86400 })}
        unit="days"
        max={365}
      />
    ),
  },
  {
    flag: "use_orientation",
    label: "Orientation",
    category: "free",
    hint: "Portrait / landscape / square must match.",
  },
  {
    flag: "use_bitrate",
    label: "Bitrate",
    category: "free",
    hint: "Group files with bitrate within a tolerance.",
    summary: (c) => `±${c.bitrate_tolerance_pct}%`,
    editor: (c, onChange) => (
      <PercentSlider
        leading={<span className="text-xs text-muted-foreground">Tolerance</span>}
        value={c.bitrate_tolerance_pct}
        onChange={(v) => onChange({ bitrate_tolerance_pct: v })}
      />
    ),
  },
  {
    flag: "use_filename",
    label: "Filename",
    category: "free",
    hint: "Fuzzy bigram similarity between filenames.",
    summary: (c) => `≥${Math.round(c.filename_threshold * 100)}%`,
    editor: (c, onChange) => (
      <PercentSlider
        leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
        value={Math.round(c.filename_threshold * 100)}
        onChange={(v) => onChange({ filename_threshold: v / 100 })}
      />
    ),
  },
  {
    flag: "use_byte_hash",
    label: "Byte hash",
    category: "extraction",
    hint: "Exact-copy check — no threshold.",
  },
  {
    flag: "use_phash",
    label: "Visual (pHash)",
    category: "extraction",
    hint: "Perceptual-hash similarity — catches re-encodes.",
    summary: (c) => `≥${phashPct(c.phash_threshold)}%`,
    editor: (c, onChange) => (
      <div className="flex flex-col gap-3">
        <PercentSlider
          leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
          value={phashPct(c.phash_threshold)}
          onChange={(v) => onChange({ phash_threshold: phashThreshold(v) })}
        />
        <div className="flex items-center gap-3">
          {(["all_frames", "first_frame"] as const).map((mode) => (
            <label key={mode} className="flex cursor-pointer select-none items-center gap-1.5">
              <input
                type="radio"
                name="phash_mode"
                checked={c.phash_mode === mode}
                onChange={() => onChange({ phash_mode: mode })}
                className="accent-[var(--px-accent)]"
              />
              <span className="text-xs text-muted-foreground">
                {mode === "all_frames" ? "All frames" : "First frame only"}
              </span>
            </label>
          ))}
        </div>
        <div
          className={cn("flex items-center gap-2", c.phash_mode === "first_frame" && "opacity-40")}
        >
          <span className="text-xs text-muted-foreground">Frames per video</span>
          <input
            type="number"
            min={4}
            max={64}
            disabled={c.phash_mode === "first_frame"}
            value={c.phash_frames}
            onChange={(e) =>
              onChange({ phash_frames: Math.min(64, Math.max(4, Number(e.target.value))) })
            }
            className="w-16 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground tabular-nums disabled:cursor-not-allowed"
          />
        </div>
      </div>
    ),
  },
  {
    flag: "use_audio",
    label: "Audio fingerprint",
    category: "extraction",
    hint: "Chromaprint similarity — matches the same audio track.",
    summary: (c) => `≥${Math.round(c.audio_threshold * 100)}%`,
    editor: (c, onChange) => (
      <PercentSlider
        leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
        value={Math.round(c.audio_threshold * 100)}
        onChange={(v) => onChange({ audio_threshold: v / 100 })}
      />
    ),
  },
];

/**
 * Duplicate-detection criteria as a compact chip row (same visual language as
 * Cleanup's query builder). Every active criterion is ANDed — a file pair is a
 * duplicate only if it matches all of them. A criterion can't be added twice.
 */
export function DuplicateCriteriaPanel({
  criteria,
  onChange,
}: {
  criteria: DuplicateCriteria;
  onChange: (patch: Patch) => void;
}) {
  const active = CRITERIA.filter((d) => criteria[d.flag]);
  const inactive = CRITERIA.filter((d) => !criteria[d.flag]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map((def) => {
        const summary = def.summary?.(criteria) ?? null;
        return (
          <div
            key={String(def.flag)}
            className="flex items-stretch overflow-hidden rounded-md border text-sm"
            style={{ borderLeft: `3px solid ${CATEGORY_COLOR[def.category]}` }}
          >
            {def.editor ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-muted/50">
                    <span className="font-medium">{def.label}</span>
                    {summary && (
                      <span className="font-mono text-xs text-muted-foreground">{summary}</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[20rem] p-3">
                  <p className="text-sm font-semibold">{def.label}</p>
                  <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground/70">{def.hint}</p>
                  {def.editor(criteria, onChange)}
                </PopoverContent>
              </Popover>
            ) : (
              <span className="px-3 py-1.5 font-medium" title={def.hint}>
                {def.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => onChange({ [def.flag]: false } as Patch)}
              title={`Remove ${def.label}`}
              className="flex w-8 items-center justify-center border-l text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {inactive.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-solid hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
              Add criterion
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1">
            {inactive.map((def) => (
              <button
                key={String(def.flag)}
                type="button"
                onClick={() => onChange({ [def.flag]: true } as Patch)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: CATEGORY_COLOR[def.category] }}
                />
                <span className="flex-1">{def.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
