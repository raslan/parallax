import { Plus, X, RotateCw, RotateCcw, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FixKey = "trim" | "audio" | "rotate" | "normalize" | "faststart" | "sync";

export type FixValues = {
  trimStart: number;
  trimEnd: number;
  audioChannel: "auto" | "left" | "right";
  rotateDeg: 90 | 180 | 270;
  syncOffsetMs: number;
};

const FIX_LABEL: Record<FixKey, string> = {
  trim: "Trim",
  audio: "Audio channel",
  rotate: "Rotate",
  normalize: "Normalize volume",
  faststart: "Faststart",
  sync: "A/V sync offset",
};

const FIX_ORDER: FixKey[] = ["trim", "audio", "rotate", "normalize", "faststart", "sync"];

// One-line value summary shown on an active chip (null = no editable value).
function chipSummary(key: FixKey, v: FixValues): string | null {
  switch (key) {
    case "trim":
      return `${v.trimStart}s start · ${v.trimEnd}s end`;
    case "audio":
      return v.audioChannel;
    case "rotate":
      return `${v.rotateDeg}°`;
    case "sync":
      return `${v.syncOffsetMs}ms`;
    default:
      return null; // normalize, faststart — no params
  }
}

const numInput =
  "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const choiceBtn = (active: boolean) =>
  cn(
    "h-9 px-3 rounded-md border text-sm capitalize transition-colors flex items-center gap-1.5",
    active
      ? "border-primary/60 bg-primary/10 text-foreground"
      : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
  );

function FixEditor({
  fixKey,
  values,
  onChange,
}: {
  fixKey: FixKey;
  values: FixValues;
  onChange: (patch: Partial<FixValues>) => void;
}) {
  if (fixKey === "trim") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Cut seconds off the start and/or end. Stream-copied — instant.
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            Start
            <input
              type="number"
              min={0}
              step={0.5}
              value={values.trimStart}
              onChange={(e) => onChange({ trimStart: Math.max(0, Number(e.target.value)) })}
              className={numInput}
            />
            sec
          </label>
          <label className="flex items-center gap-2 text-sm">
            End
            <input
              type="number"
              min={0}
              step={0.5}
              value={values.trimEnd}
              onChange={(e) => onChange({ trimEnd: Math.max(0, Number(e.target.value)) })}
              className={numInput}
            />
            sec
          </label>
        </div>
      </div>
    );
  }
  if (fixKey === "audio") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Fix one-ear audio by copying one channel to both.
        </p>
        <div className="flex gap-2">
          {(["auto", "left", "right"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => onChange({ audioChannel: opt })}
              className={choiceBtn(values.audioChannel === opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (fixKey === "rotate") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Actually rotates pixels — forces a re-encode (near-lossless CRF 18).
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onChange({ rotateDeg: 90 })}
            className={choiceBtn(values.rotateDeg === 90)}
          >
            <RotateCw className="h-3.5 w-3.5" /> 90° CW
          </button>
          <button
            onClick={() => onChange({ rotateDeg: 270 })}
            className={choiceBtn(values.rotateDeg === 270)}
          >
            <RotateCcw className="h-3.5 w-3.5" /> 90° CCW
          </button>
          <button
            onClick={() => onChange({ rotateDeg: 180 })}
            className={choiceBtn(values.rotateDeg === 180)}
          >
            <RefreshCw className="h-3.5 w-3.5" /> 180°
          </button>
        </div>
      </div>
    );
  }
  if (fixKey === "sync") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Shift audio relative to video. Positive delays audio, negative advances it.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            step={10}
            value={values.syncOffsetMs}
            onChange={(e) => onChange({ syncOffsetMs: Number(e.target.value) })}
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          ms
        </label>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground/60">
      {fixKey === "normalize"
        ? "Even out loudness (EBU R128, single-pass). No settings."
        : "Move moov atom to front — fixes slow-to-seek mp4/m4v/mov. No settings."}
    </p>
  );
}

/**
 * Compact chip row for Toolbox: one chip per active fix, a menu to add the
 * rest, a popover editor per chip. No AND/OR — the fixes just stack into one
 * job pass. A fix can't be added twice.
 */
export function ToolboxFixChips({
  active,
  values,
  onAdd,
  onRemove,
  onChange,
}: {
  active: Set<FixKey>;
  values: FixValues;
  onAdd: (key: FixKey) => void;
  onRemove: (key: FixKey) => void;
  onChange: (patch: Partial<FixValues>) => void;
}) {
  const inactive = FIX_ORDER.filter((k) => !active.has(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {FIX_ORDER.filter((k) => active.has(k)).map((key) => {
        const summary = chipSummary(key, values);
        return (
          <div
            key={key}
            className="flex items-stretch overflow-hidden rounded-md border border-primary/40 text-sm"
          >
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-primary/5 transition-colors">
                  <span className="font-medium">{FIX_LABEL[key]}</span>
                  {summary && (
                    <span className="font-mono text-xs text-muted-foreground">{summary}</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[22rem] p-3">
                <p className="mb-3 text-sm font-semibold">{FIX_LABEL[key]}</p>
                <FixEditor fixKey={key} values={values} onChange={onChange} />
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={() => onRemove(key)}
              title={`Remove ${FIX_LABEL[key]}`}
              className="flex w-8 items-center justify-center border-l border-primary/40 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {inactive.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-solid hover:text-foreground transition-colors">
              <Plus className="h-3.5 w-3.5" />
              Add fix
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            {inactive.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onAdd(key)}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                {FIX_LABEL[key]}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
