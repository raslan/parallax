import { useState, type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { RotateCcw } from "lucide-react";
import { formatSize } from "@/lib/format";
import type { ArchiveInfo, GalleryContentTypes, ListTypesResponse } from "@/types/gallery";
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
import { OptionSection } from "@/components/OptionSection";

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
  <p className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/60">
    {children}
  </p>
);

export function GalleryOptionsPanel({
  form,
  archive,
  onResetArchive,
  listTypes,
}: {
  form: UseFormReturn<GalleryOptions>;
  /** undefined while loading */
  archive: ArchiveInfo | undefined;
  onResetArchive: () => void;
  /** File mode with a real selected list: the list's content-type override. null = paste mode. */
  listTypes: {
    /** undefined while loading */
    data: ListTypesResponse | undefined;
    onSave: (types: GalleryContentTypes) => void;
    onClear: () => void;
  } | null;
}) {
  const { register, setValue, watch } = form;
  const o = watch();
  const set = <K extends keyof GalleryOptions>(k: K, v: GalleryOptions[K]) =>
    setValue(k, v as never, { shouldDirty: true });
  // Which content-type set the checkboxes edit. "All lists" is the form (global autosave);
  // "This list" bypasses the form so the global PUT can never absorb a list's values.
  const [scope, setScope] = useState<"list" | "all">("list");
  const listScope = !!listTypes && scope === "list";
  const listData = listScope ? listTypes.data : undefined;
  const types: GalleryContentTypes = listData
    ? (listData.override ?? listData.effective)
    : {
        typeVideo: o.typeVideo,
        typeAudio: o.typeAudio,
        typeImage: o.typeImage,
        typeAny: o.typeAny,
      };
  const toggleType = (key: keyof GalleryContentTypes, checked: boolean) => {
    if (listScope) listTypes.onSave({ ...types, [key]: checked });
    else set(key, checked);
  };
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
            className="text-3xs text-primary/70 hover:text-primary underline underline-offset-2 shrink-0"
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
        <div className="flex items-center justify-between gap-2">
          <Label>Content type</Label>
          {listTypes && (
            <div className="flex rounded border border-border/50 text-3xs overflow-hidden">
              {(
                [
                  ["list", "This list"],
                  ["all", "All lists"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScope(id)}
                  className={cn(
                    "px-2 py-0.5 transition-colors",
                    scope === id
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ["typeVideo", "Video"],
              ["typeAudio", "Audio"],
              ["typeImage", "Image"],
              ["typeAny", "Any"],
            ] as const
          ).map(([key, label]) => {
            const disabled = (key !== "typeAny" && types.typeAny) || (listScope && !listTypes.data);
            return (
              <label
                key={key}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs cursor-pointer transition-colors",
                  types[key]
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
              >
                <Checkbox
                  className="h-3.5 w-3.5"
                  checked={types[key]}
                  disabled={disabled}
                  onCheckedChange={(c) => toggleType(key, c === true)}
                />
                {label}
              </label>
            );
          })}
        </div>
        {listScope && listTypes.data?.override && (
          <p className="text-3xs text-muted-foreground/70">
            Overrides the global setting for this list ·{" "}
            <button
              type="button"
              onClick={listTypes.onClear}
              className="text-primary/70 hover:text-primary underline underline-offset-2"
            >
              Use global
            </button>
          </p>
        )}
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
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
          />
          <Select
            value={o.maxSizeUnit}
            onValueChange={(v) => set("maxSizeUnit", v as GalleryOptions["maxSizeUnit"])}
          >
            <SelectTrigger className="h-8 w-18 text-xs">
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
            className="text-3xs text-primary/70 hover:text-primary underline underline-offset-2"
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
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
            />
            <Select
              value={o.minSizeUnit}
              onValueChange={(v) => set("minSizeUnit", v as GalleryOptions["minSizeUnit"])}
            >
              <SelectTrigger className="h-8 w-18 text-xs">
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
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-0.5">
          <Label>HTTP timeout (s)</Label>
          <input
            type="number"
            min={1}
            max={600}
            {...register("httpTimeout", { valueAsNumber: true })}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
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
          className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Archive */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={o.useArchive} onCheckedChange={(c) => set("useArchive", c === true)} />
          <span className="text-xs text-foreground">Skip already-downloaded (archive)</span>
        </label>
        {o.useArchive && (
          <>
            <input
              type="text"
              placeholder="Custom archive path (optional)"
              {...register("archivePath")}
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
            />
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-3xs text-muted-foreground/60">
                {!archive
                  ? "…"
                  : !archive.exists
                    ? "Archive is empty"
                    : `${archive.entries === null ? "?" : archive.entries.toLocaleString()} entries · ${formatSize(archive.size)}`}
              </span>
              <button
                type="button"
                onClick={onResetArchive}
                disabled={!archive?.exists}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-border/50 px-2 py-1 text-3xs text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" />
                Reset archive
              </button>
            </div>
          </>
        )}
      </div>

      <OptionSection title="Advanced">
        {/* Range */}
        <div className="space-y-0.5">
          <Label>Range</Label>
          <input
            type="text"
            placeholder="e.g. 30-50"
            {...register("range")}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
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
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
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
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
            />
          </div>
          <div className="space-y-0.5">
            <Label>Sleep / request</Label>
            <input
              type="text"
              placeholder="0.5-1.5"
              {...register("sleepRequest")}
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
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
            className="w-full h-8 rounded border border-border/40 bg-transparent px-2 text-xs font-mono text-muted-foreground/70 focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20"
          />
        </div>

        {/* Extra args */}
        <div className="space-y-1.5">
          <Label>Extra gallery-dl args</Label>
          <textarea
            rows={3}
            placeholder="--verbose --no-skip"
            {...register("extraArgs")}
            className="w-full rounded border border-border/40 bg-transparent px-2 py-1.5 text-xs font-mono text-muted-foreground/70 focus:outline-hidden focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20 resize-none"
          />
        </div>
      </OptionSection>
    </div>
  );
}
