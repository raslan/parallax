import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AudioChannelOp } from "@/lib/api/audioToolbox";

export type AudioFixValues = {
  trimStart: number;
  trimEnd: number;
  channelOp: "" | AudioChannelOp;
  normalize: boolean;
  keepOriginal: boolean;
};

const CHANNEL_OPTIONS: { value: "" | AudioChannelOp; label: string }[] = [
  { value: "", label: "No change" },
  { value: "mono", label: "Force mono" },
  { value: "downmix_stereo", label: "Downmix to stereo" },
  { value: "left_to_both", label: "Left channel to both" },
  { value: "right_to_both", label: "Right channel to both" },
];

// SelectItem can't carry value="" — map the "no change" option to a sentinel.
const CHANNEL_SENTINEL = "__none__";

const numInput =
  "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

// Same chip vocabulary as ToolboxFixChips: solid accent border when active,
// dashed neutral border when not.
const chip = (active: boolean) =>
  cn(
    "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
    active
      ? "border-primary/40 text-foreground hover:bg-primary/5"
      : "border-dashed border-border text-muted-foreground hover:border-solid hover:text-foreground",
  );

/**
 * Audio Toolbox fix picker: a flat chip row (no add/remove menu). Trim and
 * Channel fix open a popover editor; Normalize and Keep originals are plain
 * toggle chips. Props-in/callbacks-out over the page's `AudioFixValues`.
 */
export function AudioToolboxFixChips({
  values,
  onChange,
}: {
  values: AudioFixValues;
  onChange: (v: AudioFixValues) => void;
}) {
  const patch = (p: Partial<AudioFixValues>) => onChange({ ...values, ...p });

  const trimActive = values.trimStart > 0 || values.trimEnd > 0;
  const channelActive = values.channelOp !== "";
  const channelLabel =
    CHANNEL_OPTIONS.find((o) => o.value === values.channelOp)?.label ?? "No change";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Trim */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={chip(trimActive)}>
            <span className="font-medium">Trim</span>
            {trimActive && (
              <span className="font-mono text-xs text-muted-foreground">
                {values.trimStart}s start · {values.trimEnd}s end
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] p-3">
          <p className="mb-3 text-sm font-semibold">Trim</p>
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
                  onChange={(e) => patch({ trimStart: Math.max(0, Number(e.target.value)) })}
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
                  onChange={(e) => patch({ trimEnd: Math.max(0, Number(e.target.value)) })}
                  className={numInput}
                />
                sec
              </label>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Channel fix */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={chip(channelActive)}>
            <span className="font-medium">Channel fix</span>
            {channelActive && (
              <span className="font-mono text-xs text-muted-foreground">{channelLabel}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] p-3">
          <p className="mb-3 text-sm font-semibold">Channel fix</p>
          <Select
            value={values.channelOp === "" ? CHANNEL_SENTINEL : values.channelOp}
            onValueChange={(v) =>
              patch({ channelOp: v === CHANNEL_SENTINEL ? "" : (v as AudioChannelOp) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((o) => (
                <SelectItem
                  key={o.value || CHANNEL_SENTINEL}
                  value={o.value === "" ? CHANNEL_SENTINEL : o.value}
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PopoverContent>
      </Popover>

      {/* Normalize loudness — plain toggle, no popover */}
      <button
        type="button"
        onClick={() => patch({ normalize: !values.normalize })}
        className={chip(values.normalize)}
      >
        <span className="font-medium">Normalize loudness (EBU R128, two-pass)</span>
      </button>

      {/* Keep originals — plain toggle, default on */}
      <button
        type="button"
        onClick={() => patch({ keepOriginal: !values.keepOriginal })}
        className={chip(values.keepOriginal)}
      >
        <span className="font-medium">Keep originals</span>
      </button>
    </div>
  );
}
