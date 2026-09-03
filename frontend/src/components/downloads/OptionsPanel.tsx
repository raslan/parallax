import { useState } from "react";
import { Folder, Globe, Music, Subtitles, Video } from "lucide-react";
import { DirPicker } from "@/components/DirPicker";
import { cn } from "@/lib/utils";

export interface DownloadOptions {
  audioOnly: boolean;
  quality: string;
  codec: string; // video: auto/h264/hevc/av1/vp9  audio: mp3/m4a/opus
  trimStart: string;
  trimEnd: string;
  outputDir: string;
  downloadSubs: boolean;
  subLangs: string;
  extraArgs: string;
  impersonate: string;
}

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
  opts,
  onChange,
  impersonateTargets,
}: {
  opts: DownloadOptions;
  onChange: (updates: Partial<DownloadOptions>) => void;
  impersonateTargets: string[];
}) {
  const [showDirPicker, setShowDirPicker] = useState(false);

  const handleModeToggle = (audioOnly: boolean) => {
    // Reset codec to sensible default when switching modes
    const codec = audioOnly ? "mp3" : "auto";
    onChange({ audioOnly, codec });
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
                onClick={() => onChange({ quality: q.id })}
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
                onClick={() => onChange({ codec: c })}
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
              value={opts.trimStart}
              onChange={(e) => onChange({ trimStart: e.target.value })}
              className="w-full h-8 rounded border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground/50">End</label>
            <input
              type="text"
              placeholder="HH:MM:SS"
              value={opts.trimEnd}
              onChange={(e) => onChange({ trimEnd: e.target.value })}
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
                onChange({ outputDir: p });
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
            checked={opts.downloadSubs}
            onChange={(e) => onChange({ downloadSubs: e.target.checked })}
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
            value={opts.subLangs}
            onChange={(e) => onChange({ subLangs: e.target.value })}
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
                onChange({ impersonate: e.target.checked ? (impersonateTargets[0] ?? "") : "" })
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
              onChange={(e) => onChange({ impersonate: e.target.value })}
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
          value={opts.extraArgs}
          onChange={(e) => onChange({ extraArgs: e.target.value })}
          className="w-full rounded border border-border/40 bg-transparent px-2 py-1.5 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20 resize-none"
        />
      </div>
    </div>
  );
}
