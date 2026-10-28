import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Globe, Music, Subtitles, Video } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import type { GalleryOptions } from "@/lib/schemas/gallery";
import { VIDEO_CODECS, VIDEO_QUALITIES } from "@/lib/galleryYtdl";

const AUDIO_CODECS = ["mp3", "m4a", "opus"];
const REFERER_MODES = [
  { id: "none", label: "None" },
  { id: "site", label: "Site" },
  { id: "url", label: "Video URL" },
  { id: "custom", label: "Custom" },
] as const;

const Label = ({ children }: { children: ReactNode }) => (
  <p className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/60">
    {children}
  </p>
);

const inputCls =
  "w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30";

const chipCls = (active: boolean) =>
  cn(
    "px-2.5 py-1.5 rounded border text-xs font-medium transition-colors",
    active
      ? "border-primary/60 bg-primary/10 text-foreground"
      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
  );

/**
 * yt-dlp options for the ytdl backend (YouTube channels / playlists / shorts etc.), mirroring the
 * Downloads page's panel. Non-modal right Sheet so the gallery flow stays interactive.
 * Props-in/callbacks-out over the page's persisted options form.
 */
export function YtdlOptionsSheet({
  open,
  onOpenChange,
  form,
  impersonateTargets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<GalleryOptions>;
  impersonateTargets: string[];
}) {
  const { register, setValue, watch } = form;
  const o = watch();
  const set = <K extends keyof GalleryOptions>(k: K, v: GalleryOptions[K]) =>
    setValue(k, v as never, { shouldDirty: true });

  const setAudioOnly = (audioOnly: boolean) => {
    set("ytAudioOnly", audioOnly);
    set("ytCodec", audioOnly ? "mp3" : "auto"); // sensible default per mode
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        onInteractOutside={() => onOpenChange(false)}
        className="w-[28rem] max-w-[92vw] gap-4 overflow-y-auto bg-card"
      >
        <SheetHeader>
          <SheetTitle>YouTube options</SheetTitle>
          <SheetDescription>
            yt-dlp settings for YouTube and other yt-dlp-handled URLs. Applies to new fetches;
            regular galleries ignore these.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Mode */}
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: false, label: "Video", Icon: Video },
                { id: true, label: "Audio only", Icon: Music },
              ].map(({ id, label, Icon }) => (
                <button
                  key={String(id)}
                  type="button"
                  onClick={() => setAudioOnly(id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded border text-sm font-medium transition-colors",
                    o.ytAudioOnly === id
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

          {/* Quality — video only */}
          {!o.ytAudioOnly && (
            <div className="space-y-1.5">
              <Label>Quality</Label>
              <div className="grid grid-cols-4 gap-1">
                {VIDEO_QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => set("ytQuality", q.id)}
                    className={chipCls(o.ytQuality === q.id)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="text-3xs text-muted-foreground/50">
                Caps the shorter side, so 1080p is 1920×1080 and a vertical video is 1080×1920.
              </p>
            </div>
          )}

          {/* Codec / audio format */}
          <div className="space-y-1.5">
            <Label>{o.ytAudioOnly ? "Format" : "Codec"}</Label>
            <div className="flex gap-1 flex-wrap">
              {(o.ytAudioOnly ? AUDIO_CODECS : VIDEO_CODECS.map((c) => c.id)).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("ytCodec", c)}
                  className={chipCls(o.ytCodec === c)}
                >
                  {o.ytAudioOnly
                    ? c.toUpperCase()
                    : (VIDEO_CODECS.find((v) => v.id === c)?.label ?? c)}
                </button>
              ))}
            </div>
          </div>

          {/* Parallel fragments */}
          <div className="space-y-1.5">
            <Label>Parallel fragments</Label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={64}
                {...register("ytConcurrentFragments", { valueAsNumber: true })}
                className={cn(inputCls, "w-16")}
              />
              <span className="text-3xs text-muted-foreground/50">
                per-file download connections · 4 default, higher = faster on fragmented sources
                (YouTube)
              </span>
            </div>
          </div>

          {/* Subtitles */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={o.ytDownloadSubs}
                onCheckedChange={(c) => set("ytDownloadSubs", c === true)}
              />
              <span className="text-xs text-foreground flex items-center gap-1.5">
                <Subtitles className="h-3.5 w-3.5 text-muted-foreground/60" />
                Download subtitles
              </span>
            </label>
            {o.ytDownloadSubs && (
              <input
                type="text"
                placeholder="Languages (e.g. en,fr)"
                {...register("ytSubLangs")}
                className={inputCls}
              />
            )}
          </div>

          {/* Impersonation — targets come from the installed yt-dlp (needs curl_cffi), loaded
              a moment after the page, so the control appears once they arrive. A saved value
              keeps the control visible so it can still be switched off. */}
          {(impersonateTargets.length > 0 || !!o.ytImpersonate) && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={!!o.ytImpersonate}
                  onCheckedChange={(c) =>
                    set("ytImpersonate", c === true ? (impersonateTargets[0] ?? "") : "")
                  }
                />
                <span className="text-xs text-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground/60" />
                  Impersonate browser
                </span>
              </label>
              {o.ytImpersonate && (
                <Select value={o.ytImpersonate} onValueChange={(v) => set("ytImpersonate", v)}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(impersonateTargets.includes(o.ytImpersonate)
                      ? impersonateTargets
                      : [o.ytImpersonate, ...impersonateTargets]
                    ).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Referer */}
          <div className="space-y-1.5">
            <Label>Referer</Label>
            <div className="grid grid-cols-4 gap-1">
              {REFERER_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => set("ytRefererMode", m.id)}
                  className={chipCls(o.ytRefererMode === m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {o.ytRefererMode === "custom" && (
              <input
                type="text"
                placeholder="https://example.com/"
                {...register("ytReferer")}
                className={inputCls}
              />
            )}
          </div>

          {/* Throttle recovery */}
          <div className="space-y-1.5">
            <Label>Re-extract if slower than</Label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="off"
                {...register("ytThrottledRateValue")}
                className={inputCls}
              />
              <Select
                value={o.ytThrottledRateUnit}
                onValueChange={(v) =>
                  set("ytThrottledRateUnit", v as GalleryOptions["ytThrottledRateUnit"])
                }
              >
                <SelectTrigger className="h-8 w-[5.5rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["K", "M", "G"] as const).map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}B/s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Extra args */}
          <div className="pt-2 border-t border-border/30 space-y-1.5">
            <Label>Extra yt-dlp args</Label>
            <textarea
              rows={3}
              placeholder="--sleep-interval 2 --no-mtime"
              {...register("ytExtraArgs")}
              className="w-full rounded border border-border/40 bg-transparent px-2 py-1.5 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20 resize-none"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
