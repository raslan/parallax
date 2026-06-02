import { useState, useEffect, useCallback } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Download, X, Play, StopCircle, Trash2, ChevronDown, ChevronUp,
  Loader2, ImageOff, AlertTriangle, CheckCircle2, Clock, Zap,
  Folder, Music, Video, Subtitles, Settings2, Link, RefreshCw,
} from "lucide-react";
import { api, DownloadItem, DownloadRequest } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { DirPicker } from "@/components/DirPicker";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:   { label: "Pending",   color: "text-muted-foreground",  bg: "bg-muted/40",         icon: Clock },
  running:   { label: "Running",   color: "text-primary",           bg: "bg-primary/10",        icon: Loader2 },
  completed: { label: "Done",      color: "text-emerald-400",       bg: "bg-emerald-400/10",    icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "text-red-400",           bg: "bg-red-400/10",        icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: "text-muted-foreground",  bg: "bg-muted/20",         icon: X },
} as const;

function StatusBadge({ status }: { status: DownloadItem["status"] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide",
      cfg.color, cfg.bg
    )}>
      <Icon className={cn("h-2.5 w-2.5 shrink-0", status === "running" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

// ── yt-dlp not installed banner ───────────────────────────────────────────────

function YtdlpBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/8 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-200/80 flex-1">
        <span className="font-semibold text-amber-300">yt-dlp is not installed.</span>{" "}
        Go to{" "}
        <RouterLink
          to="/settings?tab=downloads"
          className="underline underline-offset-2 font-medium hover:text-amber-300 transition-colors"
        >
          Settings → Downloads
        </RouterLink>{" "}
        to install it.
      </p>
      <button onClick={onDismiss} className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Download card ─────────────────────────────────────────────────────────────

function DownloadCard({
  item,
  onPlay,
  onRemove,
}: {
  item: DownloadItem;
  onPlay: (item: DownloadItem) => void;
  onRemove: (id: number) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const isActive = item.status === "pending" || item.status === "running";
  const canPlay = item.status === "completed" && item.output_path;

  return (
    <div className="flex gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group">
      {/* Thumbnail */}
      <div className="w-24 h-[54px] shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center relative">
        {item.thumbnail_url && !imgError ? (
          <img
            src={item.thumbnail_url}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground/30" />
        )}
        {canPlay && (
          <button
            onClick={() => onPlay(item)}
            className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Play className="h-5 w-5 text-white" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate leading-tight" title={item.title ?? item.url}>
              {item.title ?? (
                <span className="font-mono text-muted-foreground text-xs break-all line-clamp-1">{item.url}</span>
              )}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {item.uploader && (
                <span className="text-xs text-muted-foreground/60 truncate">{item.uploader}</span>
              )}
              {item.duration != null && (
                <span className="text-xs text-muted-foreground/40 shrink-0">{formatDuration(item.duration)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={item.status} />
          </div>
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="space-y-0.5">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {item.progress > 0 ? `${Math.round(item.progress)}%` : "Waiting…"}
              </span>
              {(item.speed || item.eta) && (
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                  {item.speed}{item.speed && item.eta ? " · " : ""}{item.eta ? `ETA ${item.eta}` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {item.error && (
          <button
            onClick={() => setErrorExpanded((v) => !v)}
            className="text-left w-full"
            title={errorExpanded ? "Click to collapse" : "Click to expand"}
          >
            {errorExpanded ? (
              <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono leading-relaxed">{item.error}</pre>
            ) : (
              <p className="text-[11px] text-red-400 line-clamp-2 hover:line-clamp-none">{item.error.split("\n")[0]}</p>
            )}
          </button>
        )}

        {/* Output path for completed */}
        {item.status === "completed" && item.output_path && (
          <p className="text-[10px] text-muted-foreground/40 font-mono truncate" title={item.output_path}>
            {item.output_path}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {canPlay && (
          <button
            onClick={() => onPlay(item)}
            title="Play"
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        {isActive && (
          <button
            onClick={() => onRemove(item.id)}
            title="Stop"
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
          >
            <StopCircle className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => onRemove(item.id)}
          title="Delete"
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Options panel ─────────────────────────────────────────────────────────────

interface DownloadOptions {
  audioOnly: boolean;
  quality: string;
  container: string;
  trimStart: string;
  trimEnd: string;
  outputDir: string;
  downloadSubs: boolean;
  subLangs: string;
  extraArgs: string;
  impersonate: string;  // empty = disabled
}

const VIDEO_QUALITIES = [
  { id: "best",  label: "Best" },
  { id: "2160",  label: "4K" },
  { id: "1080",  label: "1080p" },
  { id: "720",   label: "720p" },
  { id: "480",   label: "480p" },
  { id: "360",   label: "360p" },
];

const VIDEO_CONTAINERS = ["mp4", "mkv", "webm"];
const AUDIO_CONTAINERS = ["mp3", "m4a", "opus"];

function OptionsPanel({
  opts,
  onChange,
  impersonateTargets,
}: {
  opts: DownloadOptions;
  onChange: (updates: Partial<DownloadOptions>) => void;
  impersonateTargets: string[];
}) {
  const [showDirPicker, setShowDirPicker] = useState(false);
  const containers = opts.audioOnly ? AUDIO_CONTAINERS : VIDEO_CONTAINERS;

  // Reset container when switching mode if current container is invalid
  const handleModeToggle = (audioOnly: boolean) => {
    const validContainers = audioOnly ? AUDIO_CONTAINERS : VIDEO_CONTAINERS;
    const container = validContainers.includes(opts.container) ? opts.container : validContainers[0];
    onChange({ audioOnly, container });
  };

  return (
    <div className="space-y-4">
      {/* Mode */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Mode</p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: false, label: "Video", Icon: Video },
            { id: true,  label: "Audio only", Icon: Music },
          ].map(({ id, label, Icon }) => (
            <button
              key={String(id)}
              onClick={() => handleModeToggle(id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded border text-sm font-medium transition-colors",
                opts.audioOnly === id
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 bg-background text-muted-foreground hover:border-border hover:text-foreground"
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
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Quality</p>
          <div className="grid grid-cols-3 gap-1">
            {VIDEO_QUALITIES.map((q) => (
              <button
                key={q.id}
                onClick={() => onChange({ quality: q.id })}
                className={cn(
                  "px-2 py-1.5 rounded border text-xs font-medium transition-colors",
                  opts.quality === q.id
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Container */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Container</p>
        <div className="flex gap-1">
          {containers.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ container: c })}
              className={cn(
                "flex-1 px-2 py-1.5 rounded border text-xs font-mono font-medium transition-colors",
                opts.container === c
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Trim */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Trim</p>
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
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Output directory</p>
        <div className="flex items-center gap-2 rounded border border-border/50 bg-muted/20 px-3 py-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate flex-1" title={opts.outputDir}>
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
              onSelect={(p) => { onChange({ outputDir: p }); setShowDirPicker(false); }}
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
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!opts.impersonate}
                onChange={(e) => onChange({ impersonate: e.target.checked ? (impersonateTargets[0] ?? "") : "" })}
                className="h-3.5 w-3.5 accent-primary"
              />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                Impersonate browser
              </p>
            </label>
          </div>
          {opts.impersonate && (
            <select
              value={opts.impersonate}
              onChange={(e) => onChange({ impersonate: e.target.value })}
              className="h-8 w-full rounded border border-border/40 bg-transparent px-2 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {impersonateTargets.map((t) => (
                <option key={t} value={t}>{t}</option>
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
        <input
          type="text"
          placeholder="--no-playlist --write-thumbnail"
          value={opts.extraArgs}
          onChange={(e) => onChange({ extraArgs: e.target.value })}
          className="w-full h-8 rounded border border-border/40 bg-transparent px-2 text-xs font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/20"
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Downloads() {
  const [urlInput, setUrlInput] = useState("");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [playingItem, setPlayingItem] = useState<DownloadItem | null>(null);
  const [ytdlpMissing, setYtdlpMissing] = useState(false);
  const [ytdlpBannerDismissed, setYtdlpBannerDismissed] = useState(false);
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
  const [ytdlpUpdating, setYtdlpUpdating] = useState(false);
  const [impersonateTargets, setImpersonateTargets] = useState<string[]>([]);
  const [showOptions, setShowOptions] = useState(true);
  const [opts, setOpts] = useState<DownloadOptions>({
    audioOnly: false,
    quality: "best",
    container: "mp4",
    trimStart: "",
    trimEnd: "",
    outputDir: "",
    downloadSubs: false,
    subLangs: "en",
    extraArgs: "",
    impersonate: "",
  });

  // Load default output dir from settings
  useEffect(() => {
    api.getSettings().then((s) => {
      setOpts((o) => ({ ...o, outputDir: s.download_dir || "/media/downloads" }));
    }).catch(() => {});
  }, []);

  // Check yt-dlp installed + get version
  useEffect(() => {
    api.ytdlpInfo().then((info) => {
      if (!info.installed) setYtdlpMissing(true);
      setYtdlpVersion(info.version ?? null);
      if (info.installed) {
        api.ytdlpImpersonateTargets().then((r) => setImpersonateTargets(r.targets)).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleYtdlpUpdate = async () => {
    setYtdlpUpdating(true);
    try {
      await api.ytdlpUpdate();
      const info = await api.ytdlpInfo();
      setYtdlpVersion(info.version ?? null);
      setYtdlpMissing(!info.installed);
      if (info.installed) {
        api.ytdlpImpersonateTargets().then((r) => setImpersonateTargets(r.targets)).catch(() => {});
      }
    } catch { /* ignore */ } finally {
      setYtdlpUpdating(false);
    }
  };

  // SSE connection for live updates
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource(api.downloadsSseUrl());
      es.onmessage = (e) => {
        try {
          const data: DownloadItem[] = JSON.parse(e.data);
          setDownloads(data);
        } catch {}
      };
      es.onerror = () => {
        es?.close();
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const urlCount = urlInput.split("\n").filter((l) => l.trim()).length;

  const handleSubmit = useCallback(async () => {
    const urls = urlInput.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!urls.length || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: DownloadRequest = {
        urls,
        output_dir: opts.outputDir || undefined,
        audio_only: opts.audioOnly,
        quality: opts.quality,
        container: opts.container,
        trim_start: opts.trimStart || null,
        trim_end: opts.trimEnd || null,
        download_subs: opts.downloadSubs,
        sub_langs: opts.downloadSubs ? opts.subLangs : undefined,
        extra_args: opts.extraArgs || undefined,
        impersonate: opts.impersonate || null,
      };
      await api.enqueueDownloads(body);
      setUrlInput("");
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [urlInput, opts, submitting]);

  // DELETE endpoint handles both cancellation (active) and removal (settled)
  const handleRemove = useCallback(async (id: number) => {
    await api.deleteDownload(id).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleClearCompleted = useCallback(async () => {
    const done = downloads.filter((d) => d.status === "completed" || d.status === "failed" || d.status === "cancelled");
    await Promise.allSettled(done.map((d) => api.deleteDownload(d.id)));
  }, [downloads]);

  const hasCompleted = downloads.some((d) => ["completed", "failed", "cancelled"].includes(d.status));
  const activeCount = downloads.filter((d) => d.status === "pending" || d.status === "running").length;

  return (
    <div className="p-8 space-y-6">
      {/* Player modal */}
      {playingItem && playingItem.output_path && (
        <VideoPlayerModal
          file={{
            id: playingItem.id,
            filename: playingItem.title ?? playingItem.url,
            path: playingItem.output_path,
            duration: playingItem.duration,
          }}
          streamUrl={api.downloadStreamUrl(playingItem.id)}
          subtitleTracksUrl={`/api/subtitles/tracks?path=${encodeURIComponent(playingItem.output_path)}`}
          onClose={() => setPlayingItem(null)}
        />
      )}

      {/* Header */}
      <div>
        <SectionHeader className="mb-1.5">Downloader</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Queue URLs for yt-dlp download. Supports YouTube, Vimeo, Twitch, and{" "}
          <a
            href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/70 hover:text-primary transition-colors underline underline-offset-2"
          >
            1000+ other sites
          </a>.
        </p>
      </div>

      {/* yt-dlp not installed banner */}
      {ytdlpMissing && !ytdlpBannerDismissed && (
        <YtdlpBanner onDismiss={() => setYtdlpBannerDismissed(true)} />
      )}

      {/* Input + options layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">

        {/* Left: URL input */}
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link className="h-3.5 w-3.5 text-muted-foreground/50" />
              <label className="text-xs font-medium text-muted-foreground">
                URLs{urlCount > 1 && (
                  <span className="ml-1.5 text-[10px] text-primary/70 font-mono">{urlCount} URLs</span>
                )}
              </label>
            </div>
            <textarea
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={"Paste one or more URLs, one per line\nhttps://youtube.com/watch?v=…\nhttps://vimeo.com/…"}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/30 placeholder:font-sans"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!urlInput.trim() || submitting}
              className="gap-2"
            >
              {submitting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              {submitting ? "Adding…" : urlCount > 1 ? `Add ${urlCount} URLs` : "Add to queue"}
            </Button>
            <span className="text-[10px] text-muted-foreground/40">Ctrl+Enter to submit</span>
            {submitError && (
              <span className="text-xs text-red-400 ml-auto">{submitError}</span>
            )}
          </div>
        </div>

        {/* Right: Options panel */}
        <Card className="overflow-hidden border-border/50">
          <button
            onClick={() => setShowOptions((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground/60" />
              Options
            </span>
            {showOptions
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/60" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />}
          </button>
          {showOptions && (
            <div className="px-4 pb-4 pt-1 border-t border-border/40">
              <OptionsPanel
                opts={opts}
                onChange={(updates) => setOpts((o) => ({ ...o, ...updates }))}
                impersonateTargets={impersonateTargets}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SectionHeader>Queue</SectionHeader>
            {activeCount > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">
                {activeCount} active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {ytdlpVersion && (
              <span className="text-[10px] text-muted-foreground/40 font-mono">yt-dlp {ytdlpVersion}</span>
            )}
            <button
              onClick={handleYtdlpUpdate}
              disabled={ytdlpUpdating}
              className="text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
              title="Update yt-dlp to latest"
            >
              {ytdlpUpdating
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Update
            </button>
            {hasCompleted && (
              <button
                onClick={handleClearCompleted}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                Clear completed
              </button>
            )}
          </div>
        </div>

        <Card className="overflow-hidden border-border/50">
          {downloads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="rounded-full bg-muted/30 p-4">
                <Download className="h-8 w-8 text-muted-foreground/30" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">No downloads yet</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">Paste a URL above to get started</p>
              </div>
            </div>
          ) : (
            <div>
              {downloads.map((item) => (
                <DownloadCard
                  key={item.id}
                  item={item}
                  onPlay={setPlayingItem}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
