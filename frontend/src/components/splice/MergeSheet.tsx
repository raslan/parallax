import { ArrowUpDown, Loader2, Merge } from "lucide-react";
import type { VideoFile } from "@/types/file";
import type { CompressCodec } from "@/types/compress";
import type { SplicePreflight } from "@/types/splice";
import type { SortMode } from "@/lib/spliceOrder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDuration, formatSize } from "@/lib/format";
import { MergeOrderList } from "./MergeOrderList";

const SPEEDS = ["slow", "medium", "fast"];

interface MergeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: VideoFile[]; // already in merge order
  preflight: SplicePreflight | undefined;
  preflightLoading: boolean;
  codecs: CompressCodec[];
  outputName: string;
  onOutputNameChange: (v: string) => void;
  chapters: boolean;
  onChaptersChange: (v: boolean) => void;
  codec: string;
  onCodecChange: (v: string) => void;
  crf: number;
  onCrfChange: (v: number) => void;
  speed: string;
  onSpeedChange: (v: string) => void;
  referenceId: number | null;
  onReferenceChange: (id: number) => void;
  sortMode: SortMode | null;
  reverse: boolean;
  onSort: (mode: SortMode) => void;
  onReverse: () => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: number) => void;
  starting: boolean;
  startError: string | null;
  onMerge: () => void;
  preflightError: string | null;
  forceCpu: boolean;
  onForceCpuChange: (v: boolean) => void;
}

export function MergeSheet({
  open,
  onOpenChange,
  files,
  preflight,
  preflightLoading,
  codecs,
  outputName,
  onOutputNameChange,
  chapters,
  onChaptersChange,
  codec,
  onCodecChange,
  crf,
  onCrfChange,
  speed,
  onSpeedChange,
  referenceId,
  onReferenceChange,
  sortMode,
  reverse,
  onSort,
  onReverse,
  onReorder,
  onRemove,
  starting,
  startError,
  onMerge,
  preflightError,
  forceCpu,
  onForceCpuChange,
}: MergeSheetProps) {
  const info = new Map((preflight?.files ?? []).map((f) => [f.file_id, f]));
  const reencode = preflight?.verdict === "reencode";
  const codecInfo = codecs.find((c) => c.id === codec);
  const lowDisk = !!preflight && preflight.free_bytes < preflight.total_size * 1.1;
  const canMerge =
    !!preflight &&
    !preflightError &&
    !preflight.name_conflict &&
    outputName.trim().length > 0 &&
    !starting &&
    !preflightLoading &&
    files.length >= 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        className="w-full overflow-y-auto sm:w-[30rem]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>Merge {files.length} files</SheetTitle>
          <SheetDescription>
            Drag to set the order. Originals are always kept in{" "}
            <code className="font-mono text-xs">_originals/</code>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={sortMode ?? ""}
            onValueChange={(v) => v && onSort(v as SortMode)}
          >
            <ToggleGroupItem value="name">Name</ToggleGroupItem>
            <ToggleGroupItem value="duration">Duration</ToggleGroupItem>
            <ToggleGroupItem value="date">Date</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" variant="outline" onClick={onReverse}>
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            Reverse
            {reverse ? " ✓" : ""}
          </Button>
        </div>

        <MergeOrderList
          files={files}
          info={info}
          referenceId={referenceId ?? preflight?.reference_file_id ?? null}
          showReferencePick={reencode}
          onReorder={onReorder}
          onRemove={onRemove}
          onPickReference={onReferenceChange}
        />

        {preflightError && (
          <Alert variant="destructive">
            <AlertTitle>Can&apos;t merge these files</AlertTitle>
            <AlertDescription>{preflightError}</AlertDescription>
          </Alert>
        )}

        {preflight && !preflightError && (
          <Alert className={reencode ? "border-orange-500/40" : "border-green-500/30"}>
            <AlertTitle>{reencode ? "Re-encode needed" : "Stream copy — no re-encode"}</AlertTitle>
            <AlertDescription>
              {formatDuration(preflight.total_duration)} total
              {reencode ? " · size depends on quality" : ` · ≈ ${formatSize(preflight.total_size)}`}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="splice-name">Output name</Label>
          <div className="flex items-center gap-2">
            <Input
              id="splice-name"
              value={outputName}
              onChange={(e) => onOutputNameChange(e.target.value)}
            />
            <span className="shrink-0 text-sm text-muted-foreground">
              {preflight?.output_ext ?? ""}
            </span>
          </div>
          {preflight?.name_conflict && (
            <p className="text-xs text-red-400">
              {outputName}
              {preflight.output_ext} already exists in the output folder
            </p>
          )}
        </div>

        {reencode && (
          <div className="space-y-3">
            <Separator />
            <div className="space-y-1.5">
              <Label>Codec</Label>
              <Select value={codec} onValueChange={onCodecChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(codecs.length > 0 ? codecs : [{ id: codec, label: codec }]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quality (CRF) — {crf}</Label>
              <Slider
                min={codecInfo?.crf_min ?? 18}
                max={codecInfo?.crf_max ?? 35}
                step={1}
                value={[crf]}
                onValueChange={([v]) => onCrfChange(v ?? crf)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Speed</Label>
              <Select value={speed} onValueChange={onSpeedChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEEDS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="splice-cpu">Encode on CPU</Label>
              <Switch id="splice-cpu" checked={forceCpu} onCheckedChange={onForceCpuChange} />
            </div>
            <p className="text-xs text-muted-foreground">
              Output matches the starred file&apos;s size and frame rate; the others are scaled with
              black bars. Use the CPU switch if your GPU encoder isn&apos;t working.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Label htmlFor="splice-chapters">One chapter per file</Label>
          <Switch id="splice-chapters" checked={chapters} onCheckedChange={onChaptersChange} />
        </div>

        {lowDisk && (
          <Alert variant="destructive">
            <AlertTitle>Low disk space</AlertTitle>
            <AlertDescription>
              Only {formatSize(preflight.free_bytes)} free in the output folder.
            </AlertDescription>
          </Alert>
        )}
        {startError && <p className="text-xs text-red-400">{startError}</p>}

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto border-t bg-[hsl(var(--sidebar))] p-4">
          <Button className="w-full" onClick={onMerge} disabled={!canMerge}>
            {starting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Merge className="mr-2 h-4 w-4" />
            )}
            Merge {files.length} files
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
