import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Folder, Globe, Music, Subtitles, Video } from "lucide-react";
import { DirPicker } from "@/components/DirPicker";
import { cn } from "@/lib/utils";
import type { DownloadOptions } from "@/lib/schemas/download";

export type { DownloadOptions };

const VIDEO_QUALITIES = [
  { id: "best", label: "Best" },
  { id: "2160", label: "4K" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" },
  { id: "480", label: "480p" },
  { id: "360", label: "360p" },
];

const VIDEO_CODECS = [
  { id: "auto", label: "Auto" },
  { id: "h264", label: "H.264" },
  { id: "hevc", label: "H.265" },
  { id: "av1", label: "AV1" },
  { id: "vp9", label: "VP9" },
];

const AUDIO_CODECS = ["mp3", "m4a", "opus"];

export function OptionsPanel({
  form,
  impersonateTargets,
}: {
  form: UseFormReturn<DownloadOptions>;
  impersonateTargets: string[];
}) {
  const [showDirPicker, setShowDirPicker] = useState(false);
  const { register, setValue, watch } = form;
  const opts = watch();
  const set = <K extends keyof DownloadOptions>(key: K, value: DownloadOptions[K]) =>
    setValue(key, value as never, { shouldDirty: true });

  const handleModeToggle = (audioOnly: boolean) => {
    set("audioOnly", audioOnly);
    set("codec", audioOnly ? "mp3" : "auto"); // sensible default per mode
  };

  return (
    <div className="space-y-4">
      {/* Mode */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Mode
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: false, label: "Video", Icon: Video },
            { id: true, label: "Audio only", Icon: Music },
          ].map(({ id, label, Icon }) => (
            <button
              key={String(id)}
              type="button"
              onClick={() => handleModeToggle(id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded border text-sm font-medium transition-colors",
                opts.audioOnly === id
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 bg-background text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Quality — only for video */}
      {!opts.audioOnly && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Quality
          </p>
          <div className="grid grid-cols-3 gap-1">
            {VIDEO_QUALITIES.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => set("quality", q.id)}
                className={cn(
                  "px-2 py-1.5 rounded border text-xs font-medium transition-colors",
                  opts.quality === q.id
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Codec */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {opts.audioOnly ? "Format" : "Codec"}
        </p>
        <div className="flex gap-1 flex-wrap">
          {(opts.audioOnly ? AUDIO_CODECS : VIDEO_CODECS.map((c) => c.id)).map((c) => {
            const label = opts.audioOnly
              ? c.toUpperCase()
              : (VIDEO_CODECS.find((v) => v.id === c)?.label ?? c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => set("codec", c)}
                className={cn(
                  "px-2.5 py-1.5 rounded border text-xs font-medium transition-colors",
                  opts.codec === c
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Trim */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Trim
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/50">Start</label>
            <input
              type="text"
              placeholder="HH:MM:SS"
              {...register("trimStart")}
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/50">End</label>
            <input
              type="text"
              placeholder="HH:MM:SS"
              {...register("trimEnd")}
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
            />
          </div>
        </div>
      </div>

      {/* Output directory */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Output directory
        </p>
        <div className="flex items-center gap-2 rounded border border-border/50 bg-muted/20 px-3 py-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span
            className="text-xs font-mono text-muted-foreground truncate flex-1"
            title={opts.outputDir}
          >
            {opts.outputDir || "Default"}
          </span>
          <button
            type="button"
            onClick={() => setShowDirPicker(!showDirPicker)}
            className="text-[10px] text-primary/70 hover:text-primary transition-colors shrink-0 underline underline-offset-2"
          >
            Change
          </button>
        </div>
        {showDirPicker && (
          <div className="rounded border border-border/50 bg-background p-3">
            <DirPicker
              onSelect={(p) => {
                set("outputDir", p);
                setShowDirPicker(false);
              }}
              onClose={() => setShowDirPicker(false)}
            />
          </div>
        )}
      </div>

      {/* Subtitles */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register("downloadSubs")}
            className="accent-primary h-3.5 w-3.5"
          />
          <span className="text-xs text-foreground flex items-center gap-1.5">
            <Subtitles className="h-3.5 w-3.5 text-muted-foreground/60" />
            Download subtitles
          </span>
        </label>
        {opts.downloadSubs && (
          <input
            type="text"
            placeholder="Languages (e.g. en,fr)"
            {...register("subLangs")}
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
          />
        )}
      </div>

      {/* Impersonate */}
      {impersonateTargets.length > 0 && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!opts.impersonate}
              onChange={(e) =>
                set("impersonate", e.target.checked ? (impersonateTargets[0] ?? "") : "")
              }
              className="accent-primary h-3.5 w-3.5"
            />
            <span className="text-xs text-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-muted-foreground/60" />
              Impersonate browser
            </span>
          </label>
          {opts.impersonate && (
            <select
              value={opts.impersonate}
              onChange={(e) => set("impersonate", e.target.value)}
              className="h-8 w-full rounded border border-border/40 bg-transparent px-2 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {impersonateTargets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Extra args */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
          Extra yt-dlp args
        </p>
        <textarea
          rows={3}
          placeholder="--no-playlist --write-thumbnail"
          {...register("extraArgs")}
          className="w-full rounded border border-border/40 bg-transparent px-2 py-1.5 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20 resize-none"
        />
      </div>
    </div>
  );
}
