import { useState, useEffect, useCallback } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Download, X, Play, StopCircle, Trash2, ChevronDown, ChevronUp,
  Loader2, ImageOff, AlertTriangle, CheckCircle2, Clock, Zap,
  Folder, Music, Video, Subtitles, Settings2, Link, RefreshCw, Globe, ShieldCheck,
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
  onClear,
  onDeleteFile,
}: {
  item: DownloadItem;
  onPlay: (item: DownloadItem) => void;
  onClear: (id: number) => void;
  onDeleteFile: (id: number) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isActive = item.status === "pending" || item.status === "running";
  const isCompleted = item.status === "completed";
  const canPlay = isCompleted && !!item.output_path;

  const handleDeleteFile = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onDeleteFile(item.id);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group">
      {/* Thumbnail */}
      <div className="w-24 h-[54px] shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center relative">
        {item.thumbnail_url && !imgError ? (
          <img
            src={`/api/downloads/${item.id}/thumbnail`}
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
      <div className="flex-1 min-w-0 space-y-1 min-h-0">
        <p className="text-sm font-medium truncate leading-tight" title={item.title ?? item.url}>
          {item.title ?? (
            <span className="font-mono text-muted-foreground text-xs break-all line-clamp-1">{item.url}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {item.uploader && (
            <span className="text-xs text-muted-foreground/60 truncate">{item.uploader}</span>
          )}
          {item.duration != null && (
            <span className="text-xs text-muted-foreground/40 shrink-0">{formatDuration(item.duration)}</span>
          )}
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="space-y-0.5">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all duration-500",
                  item.status === "running" && item.progress === 0 && "animate-pulse w-full opacity-40"
                )}
                style={item.progress > 0 ? { width: `${item.progress}%` } : undefined}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {item.progress > 0
                  ? `${Math.round(item.progress)}%`
                  : item.status === "running" ? "Processing…" : "Waiting…"}
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
          <button onClick={() => setErrorExpanded((v) => !v)} className="text-left w-full">
            {errorExpanded ? (
              <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono leading-relaxed">{item.error}</pre>
            ) : (
              <p className="text-[11px] text-red-400 line-clamp-2">{item.error.split("\n")[0]}</p>
            )}
          </button>
        )}

        {/* Output path */}
        {isCompleted && item.output_path && (
          <p className="text-[10px] text-muted-foreground/40 font-mono truncate" title={item.output_path}>
            {item.output_path}
          </p>
        )}
      </div>

      {/* Badge — vertically centred as its own column */}
      <StatusBadge status={item.status} />

      {/* Actions */}
      {confirmDelete ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground/70">Delete file?</span>
          <button
            onClick={() => { setConfirmDelete(false); onDeleteFile(item.id); }}
            className="px-2 py-0.5 text-xs rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-0.5 text-xs rounded hover:bg-muted/60 text-muted-foreground border border-border/50 transition-colors"
          >
            No
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {canPlay && (
            <button onClick={() => onPlay(item)} title="Play"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {isActive && (
            <button onClick={() => onClear(item.id)} title="Stop download"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors">
              <StopCircle className="h-3.5 w-3.5" />
            </button>
          )}
          {!isActive && (
            <button onClick={() => onClear(item.id)} title="Remove from list"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {isCompleted && (
            <button
              onClick={handleDeleteFile}
              title="Delete file from disk (Shift+click to skip confirm)"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Playlist group ────────────────────────────────────────────────────────────

function PlaylistGroup({
  title,
  items,
  onPlay,
  onClear,
  onDeleteFile,
}: {
  title: string;
  items: DownloadItem[];
  onPlay: (item: DownloadItem) => void;
  onClear: (id: number) => void;
  onDeleteFile: (id: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const total = items.length;
  const done = items.filter((i) => i.status === "completed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const active = items.filter(
    (i) => i.status === "pending" || i.status === "running"
  ).length;

  const overallPct =
    total > 0
      ? Math.round(
          items.reduce((sum, i) => sum + (i.status === "completed" ? 100 : i.progress), 0) /
            total
        )
      : 0;

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors text-left group"
      >
        <Folder className="h-3.5 w-3.5 text-primary/70 shrink-0" />
        <span className="flex-1 text-sm font-medium text-foreground/90 truncate">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {active > 0 && (
            <span className="text-[10px] text-primary font-mono tabular-nums">{overallPct}%</span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {done}/{total}
            {failed > 0 && <span className="text-red-400 ml-1">({failed} failed)</span>}
          </span>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="pl-4 border-l border-border/30 ml-4">
          {items.map((item) => (
            <DownloadCard
              key={item.id}
              item={item}
              onPlay={onPlay}
              onClear={onClear}
              onDeleteFile={onDeleteFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Options panel ─────────────────────────────────────────────────────────────

interface DownloadOptions {
  audioOnly: boolean;
  quality: string;
  codec: string;       // video: auto/h264/hevc/av1/vp9  audio: mp3/m4a/opus
  trimStart: string;
  trimEnd: string;
  outputDir: string;
  downloadSubs: boolean;
  subLangs: string;
  extraArgs: string;
  impersonate: string;
}

const VIDEO_QUALITIES = [
  { id: "best",  label: "Best" },
  { id: "2160",  label: "4K" },
  { id: "1080",  label: "1080p" },
  { id: "720",   label: "720p" },
  { id: "480",   label: "480p" },
  { id: "360",   label: "360p" },
];

const VIDEO_CODECS = [
  { id: "auto",  label: "Auto" },
  { id: "h264",  label: "H.264" },
  { id: "hevc",  label: "H.265" },
  { id: "av1",   label: "AV1" },
  { id: "vp9",   label: "VP9" },
];

const AUDIO_CODECS = ["mp3", "m4a", "opus"];

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

  const handleModeToggle = (audioOnly: boolean) => {
    // Reset codec to sensible default when switching modes
    const codec = audioOnly ? "mp3" : "auto";
    onChange({ audioOnly, codec });
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

      {/* Codec */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {opts.audioOnly ? "Format" : "Codec"}
        </p>
        <div className="flex gap-1 flex-wrap">
          {(opts.audioOnly ? AUDIO_CODECS : VIDEO_CODECS.map((c) => c.id)).map((c) => {
            const label = opts.audioOnly ? c.toUpperCase() : (VIDEO_CODECS.find((v) => v.id === c)?.label ?? c);
            return (
              <button
                key={c}
                onClick={() => onChange({ codec: c })}
                className={cn(
                  "px-2.5 py-1.5 rounded border text-xs font-medium transition-colors",
                  opts.codec === c
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
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
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!opts.impersonate}
              onChange={(e) => onChange({ impersonate: e.target.checked ? (impersonateTargets[0] ?? "") : "" })}
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
  const [activeCookies, setActiveCookies] = useState(() => sessionStorage.getItem("dl_cookies") ?? "");
  const [showCookiesModal, setShowCookiesModal] = useState(false);
  const [cookiesDraft, setCookiesDraft] = useState("");
  const [dupeUrls, setDupeUrls] = useState<string[]>([]);
  const [opts, setOpts] = useState<DownloadOptions>({
    audioOnly: false,
    quality: "best",
    codec: "auto",
    trimStart: "",
    trimEnd: "",
    outputDir: "",
    downloadSubs: false,
    subLangs: "en",
    extraArgs: sessionStorage.getItem("dl_extra_args") ?? "",
    impersonate: sessionStorage.getItem("dl_impersonate") ?? "",
  });

  // Persist cookies + impersonate to sessionStorage
  useEffect(() => {
    if (activeCookies) sessionStorage.setItem("dl_cookies", activeCookies);
    else sessionStorage.removeItem("dl_cookies");
  }, [activeCookies]);

  useEffect(() => {
    if (opts.impersonate) sessionStorage.setItem("dl_impersonate", opts.impersonate);
    else sessionStorage.removeItem("dl_impersonate");
  }, [opts.impersonate]);

  useEffect(() => {
    if (opts.extraArgs) sessionStorage.setItem("dl_extra_args", opts.extraArgs);
    else sessionStorage.removeItem("dl_extra_args");
  }, [opts.extraArgs]);

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

  const doSubmit = useCallback(async (urls: string[]) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: DownloadRequest = {
        urls,
        output_dir: opts.outputDir || undefined,
        audio_only: opts.audioOnly,
        quality: opts.quality,
        codec: opts.codec,
        trim_start: opts.trimStart || null,
        trim_end: opts.trimEnd || null,
        download_subs: opts.downloadSubs,
        sub_langs: opts.downloadSubs ? opts.subLangs : undefined,
        extra_args: opts.extraArgs || undefined,
        impersonate: opts.impersonate || null,
        cookies: activeCookies || undefined,
      };
      await api.enqueueDownloads(body);
      setUrlInput("");
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [opts, activeCookies]);

  const handleSubmit = useCallback(() => {
    const urls = urlInput.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!urls.length || submitting) return;
    const existingSourceUrls = new Set(
      downloads.map((d) => d.source_url).filter(Boolean)
    );
    const dupes = urls.filter((u) => existingSourceUrls.has(u));
    if (dupes.length > 0) {
      setDupeUrls(dupes);
      return;
    }
    doSubmit(urls);
  }, [urlInput, submitting, downloads, doSubmit]);

  const handleDupeConfirm = useCallback(() => {
    const urls = urlInput.split("\n").map((l) => l.trim()).filter(Boolean);
    setDupeUrls([]);
    doSubmit(urls);
  }, [urlInput, doSubmit]);

  const handleDupeCancel = useCallback(() => {
    setDupeUrls([]);
  }, []);

  const handleClear = useCallback(async (id: number) => {
    await api.deleteDownload(id).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleDeleteFile = useCallback(async (id: number) => {
    await api.deleteDownloadWithFile(id).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleClearCompleted = useCallback(async () => {
    const done = downloads.filter((d) => d.status === "completed" || d.status === "failed" || d.status === "cancelled");
    await Promise.allSettled(done.map((d) => api.deleteDownload(d.id)));
    setDownloads((prev) => prev.filter((d) => d.status === "pending" || d.status === "running"));
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

      {/* Two-column layout: left = URL input + queue, right = options */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

        {/* Left: URL input + queue */}
        <div className="space-y-4">
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
                  {(() => {
                    const seen = new Set<string>();
                    const rendered: JSX.Element[] = [];

                    for (const item of downloads) {
                      if (item.playlist_id) {
                        if (seen.has(item.playlist_id)) continue;
                        seen.add(item.playlist_id);
                        const groupItems = downloads.filter(
                          (d) => d.playlist_id === item.playlist_id
                        );
                        rendered.push(
                          <PlaylistGroup
                            key={`playlist-${item.playlist_id}`}
                            title={item.playlist_title ?? item.playlist_id}
                            items={groupItems}
                            onPlay={setPlayingItem}
                            onClear={handleClear}
                            onDeleteFile={handleDeleteFile}
                          />
                        );
                      } else {
                        rendered.push(
                          <DownloadCard
                            key={item.id}
                            item={item}
                            onPlay={setPlayingItem}
                            onClear={handleClear}
                            onDeleteFile={handleDeleteFile}
                          />
                        );
                      }
                    }

                    return rendered;
                  })()}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* Right: Options (always expanded) */}
        <Card className="overflow-hidden border-border/50 sticky top-6">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground/60" />
              Options
            </div>
            <button
              onClick={() => { setCookiesDraft(activeCookies); setShowCookiesModal(true); }}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors",
                activeCookies
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "border-border/50 text-muted-foreground/60 hover:text-foreground hover:border-border"
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              Cookies
              {activeCookies && (
                <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center">1</span>
              )}
            </button>
          </div>
          <div className="px-4 pb-4 pt-3">
            <OptionsPanel
              opts={opts}
              onChange={(updates) => setOpts((o) => ({ ...o, ...updates }))}
              impersonateTargets={impersonateTargets}
            />
          </div>
        </Card>
      </div>

      {/* Cookies modal */}
      {showCookiesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCookiesModal(false)}>
          <div className="bg-card border border-border rounded-lg shadow-xl p-5 w-full max-w-lg mx-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Paste cookies</h3>
              <button onClick={() => setShowCookiesModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste cookies in Netscape format (exported via a browser extension like "Get cookies.txt"). Active for this session only — navigating away clears them.
            </p>
            <textarea
              value={cookiesDraft}
              onChange={(e) => setCookiesDraft(e.target.value)}
              placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t..."}
              rows={8}
              className="w-full rounded border border-input bg-muted/30 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/30"
            />
            <div className="flex gap-2 justify-end">
              {activeCookies && (
                <button
                  onClick={() => { setActiveCookies(""); setCookiesDraft(""); setShowCookiesModal(false); }}
                  className="px-3 py-1.5 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
                >
                  Clear cookies
                </button>
              )}
              <button onClick={() => setShowCookiesModal(false)} className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { setActiveCookies(cookiesDraft.trim()); setShowCookiesModal(false); }}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate URL confirmation dialog */}
      {dupeUrls.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Already in queue</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {dupeUrls.length === 1
                    ? "This URL was already submitted:"
                    : `${dupeUrls.length} URLs were already submitted:`}
                </p>
              </div>
            </div>
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {dupeUrls.map((u) => (
                <li key={u} className="text-xs font-mono text-muted-foreground/70 truncate px-1">{u}</li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleDupeCancel}
                className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDupeConfirm}
                className="px-3 py-1.5 text-xs bg-amber-500 text-black font-medium rounded hover:bg-amber-400 transition-colors"
              >
                Download anyway
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
