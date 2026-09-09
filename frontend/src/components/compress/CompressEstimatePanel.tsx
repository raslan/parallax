import { useState } from "react";
import { Info, SlidersHorizontal, ChevronRight } from "lucide-react";
import type { Library } from "@/types/library";
import type { VideoFile } from "@/types/file";
import type { CompressCodec } from "@/types/compress";
import { LibraryBar, KeepOriginalsToggle } from "@/components/LibraryBar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";

// ── Radio toggle group ────────────────────────────────────────────────────────
// `hint` renders as an "i" tooltip on the right of the option, not inline copy.

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
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors",
                active ? "border-primary bg-primary" : "border-muted-foreground/40",
              )}
            />
            <span className="font-medium">{opt.label}</span>
            {opt.hint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  {opt.hint}
                </TooltipContent>
              </Tooltip>
            )}
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
  const [open, setOpen] = useState(false);
  const selectedCodec = codecs.find((c) => c.id === codec);
  const tier = getCrfTier(codec, crf);

  const estimateCards: {
    label: string;
    value: string;
    sub: string;
    accent?: boolean;
    warn?: boolean;
  }[] = files
    ? [
        {
          label: "Library",
          value: formatSize(libraryTotalSize),
          sub: `${files.length} file${files.length !== 1 ? "s" : ""}`,
        },
        {
          label: "Selected",
          value: formatSize(totalSourceSize),
          sub: `${selectedCount} file${selectedCount !== 1 ? "s" : ""}`,
        },
        {
          label: "Estimated output",
          value: selectedCount > 0 ? formatSize(totalEstSize) : formatSize(libraryEstSize),
          sub: selectedCount > 0 ? "for selection" : "if all selected",
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
          } as { label: string; value: string; sub: string; accent?: boolean; warn?: boolean };
        })(),
      ]
    : [];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="shrink-0 space-y-3">
        <LibraryBar
          libraries={libraries}
          libraryId={libraryId}
          onLibraryChange={onLibraryChange}
          right={
            <KeepOriginalsToggle
              checked={keepOriginal}
              onChange={onKeepOriginalChange}
              hint="Move source to _originals/ before replacing — restore or free space later"
            />
          }
        />

        {/* Trigger — current output at a glance; opens the non-modal settings drawer
            (page stays interactive, so the estimate keeps updating as files are selected) */}
        <Sheet open={open} onOpenChange={setOpen} modal={false}>
          <SheetTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/15">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{selectedCodec?.label ?? codec.toUpperCase()}</span>
                <span className="text-muted-foreground">
                  {" · "}CRF {crf} · {speed}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                Encoding settings
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          </SheetTrigger>

          <SheetContent
            side="right"
            overlay={false}
            onInteractOutside={() => setOpen(false)}
            className="w-[34rem] max-w-[92vw] gap-4 overflow-y-auto bg-card sm:w-[38rem]"
          >
            <SheetHeader>
              <SheetTitle>Encoding settings</SheetTitle>
              <SheetDescription>
                Codec, speed, and quality — with a live size estimate for this library.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4">
              <div className="divide-y divide-border/40 rounded-lg border border-border/50 bg-muted/10">
                {/* Codec */}
                <div className="space-y-2 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      Target codec
                      {selectedCodec && (
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground/40">
                          via {selectedCodec.encoder}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                      Output video format
                    </p>
                  </div>
                  <RadioToggle
                    value={codec}
                    onChange={onCodecChange}
                    options={codecs.map((c) => ({ id: c.id, label: c.label, hint: c.description }))}
                  />
                </div>

                {/* Speed */}
                <div className="space-y-2 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">Encoding speed</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                      Slower = smaller file, more time.
                    </p>
                  </div>
                  <RadioToggle
                    value={speed}
                    onChange={onSpeedChange}
                    options={[
                      { id: "slow", label: "Slow" },
                      { id: "medium", label: "Medium" },
                      { id: "fast", label: "Fast" },
                    ]}
                  />
                </div>

                {/* CRF */}
                <div className="space-y-2 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">Quality (CRF)</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                      Lower = better quality, larger file. Each +6 roughly halves the bitrate.
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-light tabular-nums text-foreground">
                      {crf}
                    </span>
                    <span className={cn("text-sm font-medium", tier.color)}>({tier.label})</span>
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

              {/* Live estimate */}
              {files && (
                <div className="grid grid-cols-2 gap-3">
                  {estimateCards.map(({ label, value, sub, accent, warn }) => (
                    <div
                      key={label}
                      className={cn(
                        "rounded-lg border bg-muted/10 px-4 py-3",
                        warn ? "border-orange-500/30" : "border-border/50",
                      )}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {label}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-xl font-light tabular-nums",
                          warn ? "text-orange-400" : accent ? "text-green-400" : "text-foreground",
                        )}
                      >
                        {value}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
