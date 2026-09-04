import { PercentSlider } from "@/components/QueryBuilder";
import type { DuplicateCriteria } from "@/types/duplicate";
import { cn } from "@/lib/utils";

const CATEGORY_COLOR = { free: "#38bdf8", extraction: "#a78bfa" } as const;

function Pill({
  label,
  category,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  category: "free" | "extraction";
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      style={{ borderLeft: `3px solid ${enabled ? CATEGORY_COLOR[category] : "var(--border)"}` }}
    >
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="accent-[var(--px-accent)] h-3.5 w-3.5"
        />
        <span className={cn("text-sm font-medium", !enabled && "text-muted-foreground")}>
          {label}
        </span>
      </label>
      {enabled && children && <div className="pl-5.5">{children}</div>}
    </div>
  );
}

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
        className="w-16 bg-muted border border-border text-sm rounded-md px-2 py-1 text-foreground tabular-nums"
      />
      <span>{unit}</span>
    </div>
  );
}

export function DuplicateCriteriaPanel({
  criteria,
  onChange,
}: {
  criteria: DuplicateCriteria;
  onChange: (patch: Partial<DuplicateCriteria>) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Pill
        label="Exact size"
        category="free"
        enabled={criteria.use_size}
        onToggle={() => onChange({ use_size: !criteria.use_size })}
      >
        <span className="text-xs text-muted-foreground">Files must share the same byte size</span>
      </Pill>

      <Pill
        label="Duration"
        category="free"
        enabled={criteria.use_duration}
        onToggle={() => onChange({ use_duration: !criteria.use_duration })}
      >
        <ToleranceInput
          value={criteria.duration_tolerance}
          onChange={(v) => onChange({ duration_tolerance: v })}
          unit="seconds"
        />
      </Pill>

      <Pill
        label="Resolution"
        category="free"
        enabled={criteria.use_resolution}
        onToggle={() => onChange({ use_resolution: !criteria.use_resolution })}
      >
        <span className="text-xs text-muted-foreground">Exact width × height match</span>
      </Pill>

      <Pill
        label="Content date"
        category="free"
        enabled={criteria.use_content_date}
        onToggle={() => onChange({ use_content_date: !criteria.use_content_date })}
      >
        <ToleranceInput
          value={criteria.content_date_tolerance / 86400}
          onChange={(v) => onChange({ content_date_tolerance: v * 86400 })}
          unit="days"
          max={365}
        />
      </Pill>

      <Pill
        label="Orientation"
        category="free"
        enabled={criteria.use_orientation}
        onToggle={() => onChange({ use_orientation: !criteria.use_orientation })}
      >
        <span className="text-xs text-muted-foreground">Portrait / landscape / square match</span>
      </Pill>

      <Pill
        label="Bitrate"
        category="free"
        enabled={criteria.use_bitrate}
        onToggle={() => onChange({ use_bitrate: !criteria.use_bitrate })}
      >
        <PercentSlider
          leading={<span className="text-xs text-muted-foreground">Tolerance</span>}
          value={criteria.bitrate_tolerance_pct}
          onChange={(v) => onChange({ bitrate_tolerance_pct: v })}
        />
      </Pill>

      <Pill
        label="Filename similarity"
        category="free"
        enabled={criteria.use_filename}
        onToggle={() => onChange({ use_filename: !criteria.use_filename })}
      >
        <PercentSlider
          leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
          value={Math.round(criteria.filename_threshold * 100)}
          onChange={(v) => onChange({ filename_threshold: v / 100 })}
        />
      </Pill>

      <Pill
        label="Byte hash"
        category="extraction"
        enabled={criteria.use_byte_hash}
        onToggle={() => onChange({ use_byte_hash: !criteria.use_byte_hash })}
      >
        <span className="text-xs text-muted-foreground">Exact-copy check, no threshold</span>
      </Pill>

      <Pill
        label="Visual (pHash)"
        category="extraction"
        enabled={criteria.use_phash}
        onToggle={() => onChange({ use_phash: !criteria.use_phash })}
      >
        <div className="flex flex-col gap-3">
          <PercentSlider
            leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
            value={Math.round((1 - criteria.phash_threshold / 64) * 100)}
            onChange={(v) => onChange({ phash_threshold: Math.round((1 - v / 100) * 64) })}
          />
          <div className="flex items-center gap-3">
            {(["all_frames", "first_frame"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="phash_mode"
                  checked={criteria.phash_mode === mode}
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
            className={cn(
              "flex items-center gap-2",
              criteria.phash_mode === "first_frame" && "opacity-40",
            )}
          >
            <span className="text-xs text-muted-foreground">Frames per video</span>
            <input
              type="number"
              min={4}
              max={64}
              disabled={criteria.phash_mode === "first_frame"}
              value={criteria.phash_frames}
              onChange={(e) =>
                onChange({ phash_frames: Math.min(64, Math.max(4, Number(e.target.value))) })
              }
              className="w-16 bg-muted border border-border text-sm rounded-md px-2 py-1 text-foreground tabular-nums disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </Pill>

      <Pill
        label="Audio fingerprint"
        category="extraction"
        enabled={criteria.use_audio}
        onToggle={() => onChange({ use_audio: !criteria.use_audio })}
      >
        <PercentSlider
          leading={<span className="text-xs text-muted-foreground">Min similarity</span>}
          value={Math.round(criteria.audio_threshold * 100)}
          onChange={(v) => onChange({ audio_threshold: v / 100 })}
        />
      </Pill>
    </div>
  );
}
