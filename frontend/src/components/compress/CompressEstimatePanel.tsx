import { useState } from "react";
import { SlidersHorizontal, ChevronRight } from "lucide-react";
import type { Library } from "@/types/library";
import type { VideoFile } from "@/types/file";
import type { CompressCodec, ResolutionPreset } from "@/types/compress";
import { LibraryBar, KeepOriginalsToggle } from "@/components/LibraryBar";
import { RadioToggle } from "@/components/RadioToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";

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
  resolutions,
  maxResolution,
  onMaxResolutionChange,
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
  resolutions: ResolutionPreset[];
  maxResolution: string;
  onMaxResolutionChange: (id: string) => void;
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
  const selectedResolution = resolutions.find((r) => r.id === maxResolution);
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
                  {selectedResolution && selectedResolution.id !== "original" && (
                    <> · max {selectedResolution.label}</>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                Encoding settings
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          </SheetTrigger>

          <PanelSheetContent
            overlay={false}
            onInteractOutside={() => setOpen(false)}
            className="w-136 max-w-[92vw] gap-4 overflow-y-auto bg-card sm:w-152"
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
                        <span className="ml-2 font-mono text-3xs text-muted-foreground/40">
                          via {selectedCodec.encoder}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground/60">Output video format</p>
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
                    <p className="mt-0.5 text-2xs text-muted-foreground/60">
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
                    <p className="mt-0.5 text-2xs text-muted-foreground/60">
                      Lower = better quality, larger file. Each +6 roughly halves the bitrate.
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-light tabular-nums text-foreground">
                      {crf}
                    </span>
                    <span className={cn("text-sm font-medium", tier.color)}>({tier.label})</span>
                  </div>
                  <Slider
                    min={crfRange.min}
                    max={crfRange.max}
                    step={1}
                    value={[crf]}
                    onValueChange={([v]) => onCrfChange(v ?? crf)}
                    data-testid="crf-slider"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{crfRange.min} — lossless</span>
                    <span>{crfRange.max} — smallest</span>
                  </div>
                </div>

                {/* Max resolution */}
                <div className="space-y-2 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">Max resolution</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground/60">
                      Downscale sources above this size (short side) — an approximation, not an
                      exact pixel match. Quality stays governed by CRF above.
                    </p>
                  </div>
                  <RadioToggle
                    value={maxResolution}
                    onChange={onMaxResolutionChange}
                    options={resolutions.map((r) => ({ id: r.id, label: r.label }))}
                  />
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
                      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
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
                      <p className="mt-0.5 text-2xs text-muted-foreground/60">{sub}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PanelSheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
