import { useState, type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { DirPicker } from "@/components/DirPicker";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { GalleryOptions } from "@/lib/schemas/gallery";
import { Checkbox } from "@/components/ui/checkbox";

const UNITS = ["K", "M", "G", "T"] as const;
const BROWSERS = [
  "",
  "firefox",
  "chrome",
  "firefox:windows",
  "chrome:windows",
  "firefox:linux",
  "chrome:linux",
  "firefox:macos",
  "chrome:macos",
];

const Label = ({ children }: { children: ReactNode }) => (
  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
    {children}
  </p>
);

export function GalleryOptionsPanel({ form }: { form: UseFormReturn<GalleryOptions> }) {
  const { register, setValue, watch } = form;
  const o = watch();
  const set = <K extends keyof GalleryOptions>(k: K, v: GalleryOptions[K]) =>
    setValue(k, v as never, { shouldDirty: true });
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showMin, setShowMin] = useState(o.minSizeValue != null);

  return (
    <div className="space-y-4">
      {/* Base directory */}
      <div className="space-y-1.5">
        <Label>Base directory</Label>
        <div className="flex items-center gap-2 rounded border border-border/50 bg-muted/20 px-3 py-2">
          <span
            className="text-xs font-mono text-muted-foreground truncate flex-1"
            title={o.baseDir}
          >
            {o.baseDir || "Not set — pick one"}
          </span>
          <button
            type="button"
            onClick={() => setShowDirPicker((v) => !v)}
            className="text-[10px] text-primary/70 hover:text-primary underline underline-offset-2 shrink-0"
          >
            Change
          </button>
        </div>
        {showDirPicker && (
          <div className="rounded border border-border/50 bg-background p-3">
            <DirPicker
              onSelect={(p) => {
                set("baseDir", p);
                setShowDirPicker(false);
              }}
              onClose={() => setShowDirPicker(false)}
            />
          </div>
        )}
      </div>

      {/* Parallel URLs */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Parallel URLs</Label>
          <span className="text-xs font-mono text-muted-foreground">{o.maxParallel}</span>
        </div>
        <Slider
          min={1}
          max={5}
          step={1}
          value={[o.maxParallel]}
          onValueChange={([v]) => set("maxParallel", v ?? o.maxParallel)}
          className="w-full"
        />
      </div>

      {/* Content type */}
      <div className="space-y-1.5">
        <Label>Content type</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ["typeVideo", "Video"],
              ["typeAudio", "Audio"],
              ["typeImage", "Image"],
              ["typeAny", "Any"],
            ] as const
          ).map(([key, label]) => {
            const disabled = key !== "typeAny" && o.typeAny;
            return (
              <label
                key={key}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs cursor-pointer transition-colors",
                  o[key]
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
              >
                <Checkbox
                  className="h-3.5 w-3.5"
                  checked={o[key]}
                  disabled={disabled}
                  onCheckedChange={(c) => set(key, c === true)}
                />
                {label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Max size (+ min) */}
      <div className="space-y-1.5">
        <Label>Max file size</Label>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            placeholder="none"
            value={o.maxSizeValue ?? ""}
            onChange={(e) =>
              set("maxSizeValue", e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Select
            value={o.maxSizeUnit}
            onValueChange={(v) => set("maxSizeUnit", v as GalleryOptions["maxSizeUnit"])}
          >
            <SelectTrigger className="h-8 w-[4.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}B
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!showMin ? (
          <button
            type="button"
            onClick={() => setShowMin(true)}
            className="text-[10px] text-primary/70 hover:text-primary underline underline-offset-2"
          >
            ＋ min size
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              placeholder="none"
              value={o.minSizeValue ?? ""}
              onChange={(e) =>
                set("minSizeValue", e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Select
              value={o.minSizeUnit}
              onValueChange={(v) => set("minSizeUnit", v as GalleryOptions["minSizeUnit"])}
            >
              <SelectTrigger className="h-8 w-[4.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}B
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Retries + HTTP timeout */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <Label>Retries</Label>
          <input
            type="number"
            min={0}
            max={20}
            {...register("retries", { valueAsNumber: true })}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-0.5">
          <Label>HTTP timeout (s)</Label>
          <input
            type="number"
            min={1}
            max={600}
            {...register("httpTimeout", { valueAsNumber: true })}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Stop after N existing */}
      <div className="space-y-0.5">
        <Label>Stop after N existing files</Label>
        <input
          type="number"
          min={1}
          placeholder="off"
          value={o.stopAfterExisting ?? ""}
          onChange={(e) =>
            set("stopAfterExisting", e.target.value === "" ? null : Number(e.target.value))
          }
          className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Archive */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={o.useArchive} onCheckedChange={(c) => set("useArchive", c === true)} />
          <span className="text-xs text-foreground">Skip already-downloaded (archive)</span>
        </label>
        {o.useArchive && (
          <input
            type="text"
            placeholder="Custom archive path (optional)"
            {...register("archivePath")}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
          />
        )}
      </div>

      {/* Range */}
      <div className="space-y-0.5">
        <Label>Range</Label>
        <input
          type="text"
          placeholder="e.g. 30-50"
          {...register("range")}
          className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
        />
      </div>

      {/* Impersonation */}
      <div className="space-y-1.5">
        <Label>Browser impersonation</Label>
        <Select
          value={o.browser || "__none__"}
          onValueChange={(v) => set("browser", v === "__none__" ? "" : v)}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BROWSERS.map((b) => (
              <SelectItem key={b || "none"} value={b || "__none__"}>
                {b || "None"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="text"
          placeholder="Custom User-Agent (optional)"
          {...register("userAgent")}
          className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
        />
      </div>

      {/* Rate limit + sleep */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <Label>Rate limit</Label>
          <input
            type="text"
            placeholder="1M"
            {...register("limitRate")}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
          />
        </div>
        <div className="space-y-0.5">
          <Label>Sleep / request</Label>
          <input
            type="text"
            placeholder="0.5-1.5"
            {...register("sleepRequest")}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
          />
        </div>
      </div>

      {/* Advanced */}
      <div className="pt-2 border-t border-border/30 space-y-1.5">
        <Label>Advanced — filename template</Label>
        <input
          type="text"
          placeholder="{id}.{extension}"
          {...register("filenameTemplate")}
          className="w-full h-8 rounded border border-border/40 bg-transparent px-2 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20"
        />
      </div>

      {/* Extra args */}
      <div className="space-y-1.5">
        <Label>Extra gallery-dl args</Label>
        <textarea
          rows={3}
          placeholder="--verbose --no-skip"
          {...register("extraArgs")}
          className="w-full rounded border border-border/40 bg-transparent px-2 py-1.5 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20 resize-none"
        />
      </div>
    </div>
  );
}
