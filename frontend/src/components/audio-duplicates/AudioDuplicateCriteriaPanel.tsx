import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PercentSlider } from "@/components/QueryBuilder";
import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";

const CATEGORY_COLOR = { free: "#38bdf8", extraction: "#a78bfa" } as const;

type Patch = Partial<AudioDuplicateCriteria>;

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

type CritDef = {
  flag: keyof AudioDuplicateCriteria;
  label: string;
  category: "free" | "extraction";
  summary?: (c: AudioDuplicateCriteria) => string | null;
  editor?: (c: AudioDuplicateCriteria, onChange: (p: Patch) => void) => React.ReactNode;
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
    flag: "use_content_date",
    label: "Content date",
    category: "free",
    hint: "Group files shot within a window of each other.",
    summary: (c) => `±${c.content_date_tolerance}s`,
    editor: (c, onChange) => (
      <ToleranceInput
        value={c.content_date_tolerance}
        onChange={(v) => onChange({ content_date_tolerance: v })}
        unit="seconds"
      />
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
 * Audio duplicate-detection criteria as a compact chip row — same visual
 * language as the video Duplicates page's `DuplicateCriteriaPanel`. Every
 * active criterion is ANDed; a criterion can't be added twice.
 */
export function AudioDuplicateCriteriaPanel({
  criteria,
  onChange,
}: {
  criteria: AudioDuplicateCriteria;
  onChange: (c: AudioDuplicateCriteria) => void;
}) {
  const patch = (p: Patch) => onChange({ ...criteria, ...p });
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
                  {def.editor(criteria, patch)}
                </PopoverContent>
              </Popover>
            ) : (
              <span className="px-3 py-1.5 font-medium" title={def.hint}>
                {def.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => patch({ [def.flag]: false } as Patch)}
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
                onClick={() => patch({ [def.flag]: true } as Patch)}
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
