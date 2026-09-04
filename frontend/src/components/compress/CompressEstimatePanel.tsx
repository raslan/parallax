import type { Library } from "@/types/library";
import type { VideoFile } from "@/types/file";
import type { CompressCodec } from "@/types/compress";
import { CollapsibleControls } from "@/components/CollapsibleControls";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";

// ── Radio toggle group ────────────────────────────────────────────────────────

function RadioToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; hint?: string }[];
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors flex-1 min-w-[120px]",
              active
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 transition-colors",
                active ? "border-primary bg-primary" : "border-muted-foreground/40",
              )}
            />
            <span>
              <span className="font-medium block">{opt.label}</span>
              {opt.hint && (
                <span className="text-[11px] text-muted-foreground/70 block mt-0.5">
                  {opt.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── CRF quality tiers ─────────────────────────────────────────────────────────

type QualityTier = { label: string; color: string };

const CRF_TIERS: Record<string, Array<{ max: number } & QualityTier>> = {
  h264: [
    { max: 17, label: "Visually lossless", color: "text-emerald-400" },
    { max: 23, label: "High quality", color: "text-green-400" },
    { max: 28, label: "Good quality", color: "text-yellow-400" },
    { max: 35, label: "Noticeable loss", color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  hevc: [
    { max: 20, label: "Visually lossless", color: "text-emerald-400" },
    { max: 28, label: "High quality", color: "text-green-400" },
    { max: 35, label: "Good quality", color: "text-yellow-400" },
    { max: 42, label: "Noticeable loss", color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  av1: [
    { max: 25, label: "Visually lossless", color: "text-emerald-400" },
    { max: 35, label: "High quality", color: "text-green-400" },
    { max: 45, label: "Good quality", color: "text-yellow-400" },
    { max: 55, label: "Noticeable loss", color: "text-orange-400" },
    { max: 63, label: "Severe degradation", color: "text-red-400" },
  ],
};

function getCrfTier(codec: string, crf: number): QualityTier {
  const tiers = CRF_TIERS[codec] ?? CRF_TIERS.h264!;
  return tiers.find((t) => crf <= t.max) ?? tiers[tiers.length - 1]!;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CompressEstimatePanel({
  libraries,
  libraryId,
  onLibraryChange,
  codecs,
  codec,
  onCodecChange,
  speed,
  onSpeedChange,
  crf,
  onCrfChange,
  crfRange,
  keepOriginal,
  onKeepOriginalChange,
  files,
  selectedCount,
  libraryTotalSize,
  libraryEstSize,
  librarySavingsPct,
  totalSourceSize,
  totalEstSize,
  totalSavingsPct,
}: {
  libraries: Library[];
  libraryId: number | null;
  onLibraryChange: (id: number) => void;
  codecs: CompressCodec[];
  codec: string;
  onCodecChange: (id: string) => void;
  speed: string;
  onSpeedChange: (s: string) => void;
  crf: number;
  onCrfChange: (n: number) => void;
  crfRange: { min: number; max: number };
  keepOriginal: boolean;
  onKeepOriginalChange: (v: boolean) => void;
  files: VideoFile[] | null;
  selectedCount: number;
  libraryTotalSize: number;
  libraryEstSize: number;
  librarySavingsPct: number;
  totalSourceSize: number;
  totalEstSize: number;
  totalSavingsPct: number;
}) {
  const selectedCodec = codecs.find((c) => c.id === codec);

  return (
    <CollapsibleControls
      storageKey="compress-controls"
      summary={
        <>
          {libraries.find((l) => l.id === libraryId)?.name ?? "No library"} ·{" "}
          {selectedCodec?.label ?? codec.toUpperCase()} · CRF {crf} · {speed}
          {keepOriginal ? " · keep originals" : ""}
        </>
      }
    >
      <div className="p-4 space-y-4">
        {/* Settings panel */}
        <div className="rounded-lg border border-border/50 bg-muted/10 divide-y divide-border/40">
          {/* Row 1: Library */}
          <div className="px-5 py-4 flex items-center gap-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Library</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Source of files to compress
              </p>
            </div>
            <select
              value={libraryId ?? ""}
              onChange={(e) => onLibraryChange(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-64"
            >
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.path}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: Codec + Speed side by side */}
          <div className="px-5 py-4 grid grid-cols-2 gap-0 divide-x divide-border/40">
            <div className="flex items-start gap-8 pr-8">
              <div className="w-40 shrink-0">
                <p className="text-xs font-medium text-foreground">Target Codec</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Output video format</p>
                {selectedCodec && (
                  <p className="text-[10px] text-muted-foreground/40 font-mono mt-1">
                    via {selectedCodec.encoder}
                  </p>
                )}
              </div>
              <div className="flex-1">
                <RadioToggle
                  value={codec}
                  onChange={onCodecChange}
                  options={codecs.map((c) => ({ id: c.id, label: c.label, hint: c.description }))}
                />
              </div>
            </div>

            <div className="flex items-start gap-8 pl-8">
              <div className="w-40 shrink-0">
                <p className="text-xs font-medium text-foreground">Encoding Speed</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Slower finds better compression at same CRF — affects size by ~8%
                </p>
              </div>
              <div className="flex-1">
                <RadioToggle
                  value={speed}
                  onChange={onSpeedChange}
                  options={[
                    { id: "slow", label: "Slow", hint: "Best compression ratio" },
                    { id: "medium", label: "Medium", hint: "Balanced" },
                    { id: "fast", label: "Fast", hint: "Quickest encode" },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Row 3: CRF slider — full width */}
          <div className="px-5 py-4 flex items-start gap-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Quality (CRF)</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Lower = better quality, larger file. Each +6 roughly halves the bitrate.
              </p>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-light tabular-nums text-foreground">
                  {crf}
                </span>
                {(() => {
                  const tier = getCrfTier(codec, crf);
                  return (
                    <span className={cn("text-sm font-medium", tier.color)}>({tier.label})</span>
                  );
                })()}
              </div>
              <input
                type="range"
                min={crfRange.min}
                max={crfRange.max}
                step={1}
                value={crf}
                onChange={(e) => onCrfChange(Number(e.target.value))}
                className="w-full accent-primary"
                data-testid="crf-slider"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{crfRange.min} — lossless</span>
                <span>{crfRange.max} — smallest</span>
              </div>
            </div>
          </div>

          {/* Row 4: Output options */}
          <div className="px-5 py-4 flex items-center gap-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Output</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                What happens to the original file
              </p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={keepOriginal}
                onChange={(e) => onKeepOriginalChange(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5"
              />
              <div>
                <p className="text-sm text-foreground group-hover:text-foreground/90 transition-colors">
                  Keep originals
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Moves source file to <code className="font-mono">_originals/</code> before
                  replacing. Lets you restore or free space later.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Library stats */}
        {files && (
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: "Library",
                value: formatSize(libraryTotalSize),
                sub: `${files.length} file${files.length !== 1 ? "s" : ""}`,
                accent: false,
              },
              {
                label: "Selected",
                value: formatSize(totalSourceSize),
                sub: `${selectedCount} file${selectedCount !== 1 ? "s" : ""}`,
                accent: false,
              },
              {
                label: "Estimated output",
                value: selectedCount > 0 ? formatSize(totalEstSize) : formatSize(libraryEstSize),
                sub: selectedCount > 0 ? "for selection" : "if all selected",
                accent: false,
              },
              (() => {
                const useSelection = selectedCount > 0;
                const src = useSelection ? totalSourceSize : libraryTotalSize;
                const est = useSelection ? totalEstSize : libraryEstSize;
                const diff = src - est;
                const pct = useSelection ? totalSavingsPct : librarySavingsPct;
                const grows = diff < 0;
                return {
                  label: "Estimated savings",
                  value: grows ? `+${formatSize(Math.abs(diff))}` : `−${formatSize(diff)}`,
                  sub: grows
                    ? `Files would grow ${Math.abs(pct)}% — try a higher CRF`
                    : `${pct}% reduction · est. ±20%`,
                  accent: !grows,
                  warn: grows,
                };
              })(),
            ].map(
              ({
                label,
                value,
                sub,
                accent,
                warn,
              }: {
                label: string;
                value: string;
                sub: string;
                accent?: boolean;
                warn?: boolean;
              }) => (
                <div
                  key={label}
                  className={cn(
                    "rounded-lg border bg-muted/10 px-5 py-4",
                    warn ? "border-orange-500/30" : "border-border/50",
                  )}
                >
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                    {label}
                  </p>
                  <p
                    className={cn(
                      "text-2xl font-light tabular-nums mt-1",
                      warn ? "text-orange-400" : accent ? "text-green-400" : "text-foreground",
                    )}
                  >
                    {value}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </CollapsibleControls>
  );
}
