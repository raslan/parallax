import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  X,
  StopCircle,
  Trash2,
  Loader2,
  AlertTriangle,
  Settings2,
  Link,
  RefreshCw,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { api, qk } from "@/lib/api";
import { useEventSource } from "@/hooks/useEventSource";
import { useYtdlpStatus } from "@/hooks/useYtdlpStatus";
import type { DownloadItem, DownloadRequest } from "@/types/download";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { SectionHeader } from "@/components/SectionHeader";
import { DownloadCard } from "@/components/downloads/DownloadCard";
import { PlaylistGroup } from "@/components/downloads/PlaylistGroup";
import { OptionsPanel } from "@/components/downloads/OptionsPanel";
import { downloadOptionsSchema, type DownloadOptions } from "@/lib/schemas/download";
import { zodResolver } from "@/lib/zodResolver";
import { YtdlpBanner } from "@/components/downloads/YtdlpBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Main page ─────────────────────────────────────────────────────────────────

export function Downloads() {
  const [urlInput, setUrlInput] = useState("");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [playingItem, setPlayingItem] = useState<DownloadItem | null>(null);
  const [ytdlpBannerDismissed, setYtdlpBannerDismissed] = useState(false);

  const ytdlp = useYtdlpStatus();

  const [activeCookies, setActiveCookies] = useState(
    () => sessionStorage.getItem("dl_cookies") ?? "",
  );
  const [showCookiesModal, setShowCookiesModal] = useState(false);
  const [cookiesDraft, setCookiesDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed" | "failed">(
    "all",
  );
  const [dupeUrls, setDupeUrls] = useState<string[]>([]);
  const optsForm = useForm<DownloadOptions>({
    resolver: zodResolver(downloadOptionsSchema),
    defaultValues: {
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
    },
  });
  // Persist cookies to sessionStorage
  useEffect(() => {
    if (activeCookies) sessionStorage.setItem("dl_cookies", activeCookies);
    else sessionStorage.removeItem("dl_cookies");
  }, [activeCookies]);

  // Persist impersonate + extra args as they change (survives a page refresh)
  useEffect(() => {
    const sub = optsForm.watch((v) => {
      const put = (k: string, val: string | undefined) =>
        val ? sessionStorage.setItem(k, val) : sessionStorage.removeItem(k);
      put("dl_impersonate", v.impersonate);
      put("dl_extra_args", v.extraArgs);
    });
    return () => sub.unsubscribe();
  }, [optsForm]);

  // Load default output dir from settings (one-time seed of the form field)
  const { data: settings } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });
  useEffect(() => {
    // One-time seed of the output-dir field from saved settings; the empty-check
    // keeps a user edit from being clobbered on a settings refetch.
    if (settings && !optsForm.getValues("outputDir")) {
      optsForm.setValue("outputDir", settings.download_dir || "/media/downloads");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // SSE connection for live updates
  useEventSource<DownloadItem[]>(api.downloadsSseUrl(), setDownloads);

  const urlCount = urlInput.split("\n").filter((l) => l.trim()).length;

  const doSubmit = useCallback(
    async (urls: string[]) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const opts = optsForm.getValues();
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
    },
    [optsForm, activeCookies],
  );

  const handleSubmit = useCallback(() => {
    const urls = urlInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!urls.length || submitting) return;
    const existingSourceUrls = new Set(downloads.map((d) => d.source_url).filter(Boolean));
    const dupes = urls.filter((u) => existingSourceUrls.has(u));
    if (dupes.length > 0) {
      setDupeUrls(dupes);
      return;
    }
    doSubmit(urls);
  }, [urlInput, submitting, downloads, doSubmit]);

  const handleDupeConfirm = useCallback(() => {
    const urls = urlInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    setDupeUrls([]);
    doSubmit(urls);
  }, [urlInput, doSubmit]);

  const handleDupeCancel = useCallback(() => {
    setDupeUrls([]);
  }, []);

  const handleRetry = useCallback(
    async (id: number) => {
      const item = downloads.find((d) => d.id === id);
      if (!item) return;
      const opts = item.options ? JSON.parse(item.options) : {};
      const result = await api
        .enqueueDownloads({
          urls: [item.url],
          output_dir: item.output_dir,
          audio_only: opts.audio_only,
          quality: opts.quality,
          codec: opts.codec,
          trim_start: opts.trim_start,
          trim_end: opts.trim_end,
          download_subs: opts.download_subs,
          sub_langs: opts.sub_langs,
          extra_args: opts.extra_args,
          impersonate: opts.impersonate,
          cookies: activeCookies || undefined,
        })
        .catch(() => null);
      if (!result) return;
      // Old failed/cancelled row is superseded by the new one — remove it so it doesn't linger.
      await api.deleteDownload(id).catch(() => {});
      setDownloads((prev) => prev.filter((d) => d.id !== id));
    },
    [downloads, activeCookies],
  );

  const handleRetryAllFailed = useCallback(async () => {
    await api.retryAllFailedDownloads().catch(() => {});
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
    await api.clearDownloads(["completed"]).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.status !== "completed"));
  }, []);

  const handleClearAll = useCallback(async () => {
    await api.clearDownloads(["completed", "failed", "cancelled"]).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.status === "pending" || d.status === "running"));
  }, []);

  const handleStopAll = useCallback(async () => {
    await api.stopAllDownloads().catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.status !== "pending" && d.status !== "running"));
  }, []);

  const hasCompleted = downloads.some((d) => d.status === "completed");
  const hasFinished = downloads.some((d) =>
    ["completed", "failed", "cancelled"].includes(d.status),
  );
  const hasFailed = downloads.some((d) => d.status === "failed" || d.status === "cancelled");
  const activeCount = downloads.filter(
    (d) => d.status === "pending" || d.status === "running",
  ).length;
  const filteredDownloads = downloads.filter((d) => {
    if (statusFilter === "active") return d.status === "pending" || d.status === "running";
    if (statusFilter === "completed") return d.status === "completed";
    if (statusFilter === "failed") return d.status === "failed" || d.status === "cancelled";
    return true;
  });

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
          isAudio={/\.(mp3|m4a|opus|flac|wav|ogg|aac)$/i.test(playingItem.output_path)}
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
          </a>
          .
        </p>
      </div>

      {/* yt-dlp not installed banner */}
      {ytdlp.missing && !ytdlpBannerDismissed && (
        <YtdlpBanner onDismiss={() => setYtdlpBannerDismissed(true)} />
      )}

      {/* Two-column layout: left = URL input + queue, right = options */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        {/* Left: URL input + queue */}
        <div className="space-y-4 min-w-0">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link className="h-3.5 w-3.5 text-muted-foreground/50" />
              <label className="text-xs font-medium text-muted-foreground">
                URLs
                {urlCount > 1 && (
                  <span className="ml-1.5 text-[10px] text-primary/70 font-mono">
                    {urlCount} URLs
                  </span>
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
              placeholder={
                "Paste one or more URLs, one per line\nhttps://youtube.com/watch?v=…\nhttps://vimeo.com/…"
              }
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
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {submitting ? "Adding…" : urlCount > 1 ? `Add ${urlCount} URLs` : "Add to queue"}
            </Button>
            <span className="text-[10px] text-muted-foreground/40">Ctrl+Enter to submit</span>
            {submitError && <span className="text-xs text-red-400 ml-auto">{submitError}</span>}
          </div>

          {/* Queue */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SectionHeader>Queue</SectionHeader>
                {activeCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20"
                  >
                    {activeCount} active
                  </Badge>
                )}
                {downloads.length > 0 && (
                  <div className="flex items-center gap-1">
                    {(["all", "active", "completed", "failed"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-medium transition-colors capitalize",
                          statusFilter === f
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "text-muted-foreground/50 hover:text-muted-foreground border border-transparent",
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {ytdlp.version && (
                  <span className="text-[10px] text-muted-foreground/40 font-mono">
                    yt-dlp {ytdlp.version}
                  </span>
                )}
                <button
                  onClick={ytdlp.update}
                  disabled={ytdlp.updating}
                  className="text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
                  title="Update yt-dlp to latest"
                >
                  {ytdlp.updating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Update
                </button>
                {hasFailed && (
                  <button
                    onClick={handleRetryAllFailed}
                    className="text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry all failed
                  </button>
                )}
                {activeCount > 0 && (
                  <button
                    onClick={handleStopAll}
                    className="text-xs text-muted-foreground/50 hover:text-red-400 transition-colors flex items-center gap-1"
                  >
                    <StopCircle className="h-3 w-3" />
                    Stop all
                  </button>
                )}
                {hasCompleted && (
                  <button
                    onClick={handleClearCompleted}
                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear completed
                  </button>
                )}
                {hasFinished && (
                  <button
                    onClick={handleClearAll}
                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear all
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
                    <p className="text-xs text-muted-foreground/50 mt-0.5">
                      Paste a URL above to get started
                    </p>
                  </div>
                </div>
              ) : filteredDownloads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <p className="text-sm text-muted-foreground/50">No {statusFilter} downloads</p>
                </div>
              ) : (
                <div>
                  {(() => {
                    const groups = new Map<string, DownloadItem[]>();
                    const order: (string | number)[] = []; // playlist_id strings, or item.id numbers for ungrouped

                    for (const item of filteredDownloads) {
                      if (item.playlist_id) {
                        if (!groups.has(item.playlist_id)) {
                          groups.set(item.playlist_id, []);
                          order.push(item.playlist_id);
                        }
                        groups.get(item.playlist_id)!.push(item);
                      } else {
                        order.push(item.id);
                      }
                    }

                    const itemById = new Map(filteredDownloads.map((d) => [d.id, d]));

                    return order.map((key) => {
                      if (typeof key === "number") {
                        const item = itemById.get(key)!;
                        return (
                          <DownloadCard
                            key={item.id}
                            item={item}
                            onPlay={setPlayingItem}
                            onClear={handleClear}
                            onDeleteFile={handleDeleteFile}
                            onRetry={handleRetry}
                          />
                        );
                      }
                      const groupItems = groups.get(key)!;
                      return (
                        <PlaylistGroup
                          key={`playlist-${key}`}
                          title={groupItems[0].playlist_title ?? key}
                          items={groupItems}
                          onPlay={setPlayingItem}
                          onClear={handleClear}
                          onDeleteFile={handleDeleteFile}
                          onRetry={handleRetry}
                        />
                      );
                    });
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
              onClick={() => {
                setCookiesDraft(activeCookies);
                setShowCookiesModal(true);
              }}
              className={cn(
                "relative flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors",
                activeCookies
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "border-border/50 text-muted-foreground/60 hover:text-foreground hover:border-border",
              )}
            >
              <ShieldCheck className="h-3 w-3" />
              Cookies
              {activeCookies && (
                <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-black flex items-center justify-center">
                  1
                </span>
              )}
            </button>
          </div>
          <div className="px-4 pb-4 pt-3">
            <OptionsPanel form={optsForm} impersonateTargets={ytdlp.impersonateTargets} />
          </div>
        </Card>
      </div>

      {/* Cookies modal */}
      {showCookiesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowCookiesModal(false)}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-xl p-5 w-full max-w-lg mx-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Paste cookies</h3>
              <button
                onClick={() => setShowCookiesModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste cookies in Netscape format (exported via a browser extension like "Get
              cookies.txt"). Active for this session only — navigating away clears them.
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
                  onClick={() => {
                    setActiveCookies("");
                    setCookiesDraft("");
                    setShowCookiesModal(false);
                  }}
                  className="px-3 py-1.5 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
                >
                  Clear cookies
                </button>
              )}
              <button
                onClick={() => setShowCookiesModal(false)}
                className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setActiveCookies(cookiesDraft.trim());
                  setShowCookiesModal(false);
                }}
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
                <li key={u} className="text-xs font-mono text-muted-foreground/70 truncate px-1">
                  {u}
                </li>
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
