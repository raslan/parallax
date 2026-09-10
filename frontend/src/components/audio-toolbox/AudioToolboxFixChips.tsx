import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudioChannelOp } from "@/lib/api/audioToolbox";

export type AudioFixKey = "trim" | "channel" | "normalize";

export type AudioFixValues = {
  trimStart: number;
  trimEnd: number;
  channelOp: AudioChannelOp;
};

const FIX_LABEL: Record<AudioFixKey, string> = {
  trim: "Trim",
  channel: "Channel fix",
  normalize: "Normalize loudness",
};

const FIX_ORDER: AudioFixKey[] = ["trim", "channel", "normalize"];

const CHANNEL_OPTIONS: { value: AudioChannelOp; label: string }[] = [
  { value: "mono", label: "Force mono" },
  { value: "downmix_stereo", label: "Downmix to stereo" },
  { value: "left_to_both", label: "Left channel to both" },
  { value: "right_to_both", label: "Right channel to both" },
];

// One-line value summary shown on an active chip (null = no editable value).
function chipSummary(key: AudioFixKey, v: AudioFixValues): string | null {
  switch (key) {
    case "trim":
      return `${v.trimStart}s start · ${v.trimEnd}s end`;
    case "channel":
      return CHANNEL_OPTIONS.find((o) => o.value === v.channelOp)?.label ?? v.channelOp;
    default:
      return null; // normalize — no params
  }
}

const numInput =
  "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function FixEditor({
  fixKey,
  values,
  onChange,
}: {
  fixKey: AudioFixKey;
  values: AudioFixValues;
  onChange: (patch: Partial<AudioFixValues>) => void;
}) {
  if (fixKey === "trim") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Cut seconds off the start and/or end.
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
  if (fixKey === "channel") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground/60">
          Remap channels — fix one-ear audio or collapse to mono.
        </p>
        <Select
          value={values.channelOp}
          onValueChange={(v) => onChange({ channelOp: v as AudioChannelOp })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground/60">
      Even out loudness to EBU R128 (two-pass). No settings.
    </p>
  );
}

/**
 * Compact chip row for Audio Toolbox: one chip per active fix, a menu to add
 * the rest, a popover editor per chip. No AND/OR — the fixes just stack into
 * one job pass. A fix can't be added twice. Mirrors `toolbox/ToolboxFixChips`.
 */
export function AudioToolboxFixChips({
  active,
  values,
  onAdd,
  onRemove,
  onChange,
}: {
  active: Set<AudioFixKey>;
  values: AudioFixValues;
  onAdd: (key: AudioFixKey) => void;
  onRemove: (key: AudioFixKey) => void;
  onChange: (patch: Partial<AudioFixValues>) => void;
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
