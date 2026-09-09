import { useState } from "react";
import { SlidersHorizontal, ChevronRight } from "lucide-react";
import type { Library } from "@/types/library";
import type { AudioCodec } from "@/types/audio";
import { LibraryBar, KeepOriginalsToggle } from "@/components/LibraryBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
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
import { audioSavingsPct } from "@/lib/audioCompress";

export function AudioEstimatePanel({
  libraries,
  libraryId,
  onLibraryChange,
  codecs,
  codec,
  onCodecChange,
  bitrate,
  onBitrateChange,
  keepOriginal,
  onKeepOriginalChange,
  selectedCount,
  currentBytes,
  estimatedBytes,
}: {
  libraries: Library[];
  libraryId: number | null;
  onLibraryChange: (id: number) => void;
  codecs: AudioCodec[];
  codec: string;
  onCodecChange: (id: string) => void;
  bitrate: number;
  onBitrateChange: (n: number) => void;
  keepOriginal: boolean;
  onKeepOriginalChange: (v: boolean) => void;
  selectedCount: number;
  currentBytes: number;
  estimatedBytes: number;
}) {
  const [open, setOpen] = useState(false);
  const selectedCodec = codecs.find((c) => c.id === codec);
  const savings = audioSavingsPct(currentBytes, estimatedBytes);

  // The tier a chosen bitrate lands in: the first (ascending) tier it fits under.
  const activeTierMax =
    selectedCodec?.tiers.find((t) => bitrate <= t.max_kbps)?.max_kbps ??
    selectedCodec?.tiers[selectedCodec.tiers.length - 1]?.max_kbps;

  const estimateCards = [
    { label: "Selected", value: `${selectedCount}`, sub: `file${selectedCount !== 1 ? "s" : ""}` },
    { label: "Current size", value: formatSize(currentBytes), sub: "for selection" },
    { label: "Estimated output", value: formatSize(estimatedBytes), sub: "for selection" },
    {
      label: "Estimated savings",
      value: `−${savings}%`,
      sub: "est. ±5%",
      accent: savings > 0,
    },
  ];

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

        <Sheet open={open} onOpenChange={setOpen} modal={false}>
          <SheetTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/15">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{selectedCodec?.label ?? codec.toUpperCase()}</span>
                <span className="text-muted-foreground">{` · ${bitrate}k`}</span>
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
                Codec and bitrate — with a live size estimate for the selection.
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
                          via {selectedCodec.encoder} · {selectedCodec.ext}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                      Output audio format
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {codecs.map((c) => {
                      const active = c.id === codec;
                      return (
                        <button
                          key={c.id}
                          onClick={() => onCodecChange(c.id)}
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
                          <span className="font-medium">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bitrate */}
                <div className="space-y-2 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">Bitrate</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                      Higher = better quality, larger file. Output is never up-converted past the
                      source.
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-light tabular-nums text-foreground">
                      {bitrate}
                    </span>
                    <span className="text-sm text-muted-foreground">kbps</span>
                  </div>
                  <Slider
                    min={selectedCodec?.bitrate_min ?? 32}
                    max={selectedCodec?.bitrate_max ?? 320}
                    step={8}
                    value={[bitrate]}
                    onValueChange={([v]) =>
                      onBitrateChange(v ?? selectedCodec?.bitrate_default ?? bitrate)
                    }
                    data-testid="bitrate-slider"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{selectedCodec?.bitrate_min ?? 32}k</span>
                    <span>{selectedCodec?.bitrate_max ?? 320}k</span>
                  </div>
                </div>
              </div>

              {/* Live estimate */}
              <div className="grid grid-cols-2 gap-3">
                {estimateCards.map(({ label, value, sub, accent }) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-xl font-light tabular-nums",
                        accent ? "text-green-400" : "text-foreground",
                      )}
                    >
                      {value}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Tier table */}
              {selectedCodec && (
                <div className="overflow-hidden rounded-lg border border-border/50">
                  {selectedCodec.tiers.map((t) => (
                    <div
                      key={t.max_kbps}
                      className={cn(
                        "flex items-center justify-between px-4 py-2 text-xs",
                        t.max_kbps === activeTierMax
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <span className="font-mono">≤{t.max_kbps}k</span>
                      <span>{t.label}</span>
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
