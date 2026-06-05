import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Check, Palette, KeyRound, Cpu, Clapperboard, Download, Trash2, AlertCircle, OctagonAlert, FolderOpen } from "lucide-react";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, modelsApi, ModelInfo, ActiveModelDownload } from "@/lib/api";
import { toast } from "sonner"; // sonner toast fn works independently of Toaster wrapper
import { DirPicker } from "@/components/DirPicker";
import { useTheme } from "@/components/ThemeProvider";
import { SectionHeader } from "@/components/SectionHeader";
import { formatSize } from "@/lib/format";

const THEMES = [
  { id: "violet"  as const, label: "Deep Space",      accent: "#a78bfa" },
  { id: "cyan"    as const, label: "Modern HUD",      accent: "#22d3ee" },
  { id: "amber"   as const, label: "Mission Control", accent: "#f59e0b" },
  { id: "oled"    as const, label: "OLED",            accent: "#ffffff" },
  { id: "rose"    as const, label: "Crimson Noir",    accent: "#fb7185" },
  { id: "emerald" as const, label: "Neon Grid",       accent: "#34d399" },
  { id: "indigo"  as const, label: "Midnight Blue",   accent: "#818cf8" },
];

const TABS = [
  { id: "general",      label: "General",         icon: Palette },
  { id: "transcoder",   label: "Transcoder",      icon: Clapperboard },
  { id: "credentials",  label: "Keys & Accounts", icon: KeyRound },
  { id: "ai",           label: "AI Models",       icon: Cpu },
  { id: "downloads",    label: "Downloads",       icon: Download },
] as const;

type TabId = typeof TABS[number]["id"];

function ModelCard({ model, onAction, activeDownload }: {
  model: ModelInfo;
  onAction: () => void;
  activeDownload?: ActiveModelDownload | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadJobId, setDownloadJobId] = useState<number | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [jobStatus, setJobStatus] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Reconnect to an in-progress download after navigation
  useEffect(() => {
    if (
      activeDownload &&
      activeDownload.model_type === model.type &&
      activeDownload.model_id === model.id &&
      !model.downloaded
    ) {
      setBusy(true);
      setJobProgress(activeDownload.progress ?? 0);
      setJobStatus(activeDownload.current_file ?? activeDownload.status);
      setDownloadJobId(activeDownload.job_id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (downloadJobId === null) return;
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(downloadJobId);
        setJobProgress(job.progress ?? 0);
        if (job.status === "completed") {
          stopPolling();
          setDownloadJobId(null);
          setBusy(false);
          onAction();
        } else if (job.status === "failed") {
          stopPolling();
          setDownloadJobId(null);
          setBusy(false);
          setError(job.error ?? "Download failed");
        } else if (job.status === "cancelled") {
          stopPolling();
          setDownloadJobId(null);
          setBusy(false);
        } else {
          setJobStatus(job.current_file ?? job.status);
        }
      } catch {
        // transient error — keep polling
      }
    }, 1500);
    return stopPolling;
  }, [downloadJobId, onAction, stopPolling]);

  const download = async () => {
    setBusy(true);
    setError(null);
    setJobProgress(0);
    setJobStatus("Starting…");
    try {
      const res = await (model.type === "clip"
        ? modelsApi.downloadClip(model.id)
        : model.type === "whisper"
        ? modelsApi.downloadWhisper(model.id)
        : modelsApi.downloadNudenet(model.id));
      setDownloadJobId(res.job_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await (model.type === "clip" ? modelsApi.deleteClip(model.id) : model.type === "whisper" ? modelsApi.deleteWhisper(model.id) : modelsApi.deleteNudenet(model.id));
      onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      await (model.type === "clip" ? modelsApi.activateClip(model.id) : model.type === "whisper" ? modelsApi.activateWhisper(model.id) : modelsApi.activateNudenet(model.id));
      onAction();
      if (model.type === "clip" || model.type === "nudenet") {
        toast("Model changed — rescan recommended to update keyframe resolution", { duration: 4000 });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloading = busy && downloadJobId !== null;

  return (
    <div className={`rounded-lg border p-4 transition-colors ${model.active ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{model.name}</span>
            {model.active && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">Active</span>
            )}
            {model.bundled && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Bundled</span>
            )}
            {!model.bundled && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatSize(model.size_mb * 1024 * 1024)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
          {downloading && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">{jobStatus}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 ml-2">{Math.round(jobProgress)}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${jobProgress}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />{error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!model.downloaded && !model.bundled && !downloading && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={download} disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Download
            </Button>
          )}
          {downloading && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {model.downloaded && !model.active && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={activate} disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Use"}
              </Button>
              {!model.bundled && (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={remove} disabled={busy}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
          {model.active && !model.bundled && (
            <span className="text-[10px] text-muted-foreground">In use</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { theme, setTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "general";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const [maxConcurrent, setMaxConcurrent]         = useState(1);
  const [encoderFamily, setEncoderFamily]         = useState<string>("software");
  const [concurrentLimitHint, setConcurrentLimitHint] = useState<number | null>(null);
  const [tmdbKey, setTmdbKey]                     = useState("");
  const [videoKeyframesPerVideo, setVideoKeyframesPerVideo] = useState(32);
  const [scanBatchSize, setScanBatchSize]                   = useState(4);
  const [scanPrefetch, setScanPrefetch]                     = useState(4);
  const [osUsername, setOsUsername]               = useState("");
  const [osPassword, setOsPassword]               = useState("");
  const [subtitleLangs, setSubtitleLangs]         = useState<string[]>(["en"]);
  const [loading, setLoading]                     = useState(true);
  const [saving, setSaving]                       = useState(false);
  const [saved, setSaved]                         = useState(false);
  const [dirty, setDirty]                         = useState(false);

  const [downloadDir, setDownloadDir]               = useState("/media/downloads");
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(2);
  const [ytdlpChannel, setYtdlpChannel]             = useState<"stable" | "nightly">("stable");
  const [ytdlpInfo, setYtdlpInfo]                   = useState<{ installed: boolean; version: string | null; path: string | null } | null>(null);
  const [ytdlpUpdating, setYtdlpUpdating]           = useState(false);
  const [showDirPicker, setShowDirPicker]           = useState(false);

  const [models, setModels]             = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [activeDownload, setActiveDownload] = useState<ActiveModelDownload | null>(null);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setMaxConcurrent(s.max_concurrent_transcodes);
        setEncoderFamily(s.encoder_family ?? "software");
        setConcurrentLimitHint(s.concurrent_limit_hint ?? null);
        setTmdbKey(s.tmdb_api_key);
        setVideoKeyframesPerVideo(s.video_keyframes_per_video ?? 8);
        setScanBatchSize(s.scan_batch_size ?? 4);
        setScanPrefetch(s.scan_prefetch ?? 4);
        setOsUsername(s.opensubtitles_username ?? "");
        setOsPassword(s.opensubtitles_password ?? "");
        setSubtitleLangs((s.subtitle_languages || "en").split(",").map((c) => c.trim()).filter(Boolean));
        setDownloadDir(s.download_dir ?? "/media/downloads");
        setMaxConcurrentDownloads(s.max_concurrent_downloads ?? 2);
        setYtdlpChannel((s.ytdlp_channel === "nightly" ? "nightly" : "stable") as "stable" | "nightly");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "downloads") {
      api.ytdlpInfo().then(setYtdlpInfo).catch(() => {});
    }
  }, [activeTab]);

  const reloadModels = useCallback(() => {
    setModelsLoading(true);
    Promise.all([
      modelsApi.listModels(),
      modelsApi.getActiveDownload(),
    ])
      .then(([modelList, dl]) => {
        setModels(modelList);
        setActiveDownload(dl);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => { reloadModels(); }, [reloadModels]);

  const markDirty = () => { setDirty(true); setSaved(false); };
  const handleConcurrentChange = (n: number) => { setMaxConcurrent(n); markDirty(); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ max_concurrent_transcodes: maxConcurrent, tmdb_api_key: tmdbKey, video_keyframes_per_video: videoKeyframesPerVideo, scan_batch_size: scanBatchSize, scan_prefetch: scanPrefetch, opensubtitles_username: osUsername, opensubtitles_password: osPassword, subtitle_languages: subtitleLangs.join(","), download_dir: downloadDir, max_concurrent_downloads: maxConcurrentDownloads, ytdlp_channel: ytdlpChannel });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const clipModels    = models.filter((m) => m.type === "clip");
  const nudenetModels = models.filter((m) => m.type === "nudenet");
  const whisperModels = models.filter((m) => m.type === "whisper");

  const SaveButton = () => (
    <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
      {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
      {saved  && <Check   className="h-3.5 w-3.5 mr-2 text-green-400" />}
      {saved ? "Saved" : "Save changes"}
    </Button>
  );

  return (
    <div className="p-8 space-y-6">
      <div>
        <SectionHeader className="mb-1.5">App configuration</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure Parallax behaviour.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* General */}
      {activeTab === "general" && (
        <>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Colour theme</p>
                <p className="text-xs text-muted-foreground mb-4">Takes effect immediately.</p>
                <div className="flex gap-3">
                  {THEMES.map((t) => {
                    const isActive = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`w-32 flex flex-col items-center gap-2 p-3 rounded-[0.4rem] border transition-colors ${
                          isActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="h-8 w-8 rounded-full" style={{ background: t.accent }} />
                        <span className="text-xs font-medium text-center leading-tight">{t.label}</span>
                        {isActive && <Check className="h-3 w-3 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
          <DangerZone />
        </>
      )}

      {/* Transcoder */}
      {activeTab === "transcoder" && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />Loading…
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Concurrent transcodes</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      How many files to encode in parallel within a compress job. Each session shares the GPU's fixed encode hardware — setting this above the number of encode engines on your card makes each file take proportionally longer with no improvement in total time.
                      {encoderFamily === "nvenc"
                        ? " NVIDIA: RTX 3050/3060 = 1 engine · RTX 3080/3090 = 2 · RTX 4090 = 3."
                        : encoderFamily === "qsv"
                        ? " Intel: UHD 630/730 = 1 engine · UHD 770 / Iris Xe / Arc = 2."
                        : encoderFamily === "amf" || encoderFamily === "vaapi"
                        ? " AMD: RX 6000 series = 1 engine · RX 7000 high-end = 2."
                        : " No hardware encoder detected — using CPU software encoding."}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={maxConcurrent}
                      onChange={(e) => handleConcurrentChange(Number(e.target.value))}
                      className="w-48 accent-primary"
                    />
                    <span className="text-sm font-mono w-4 text-center">{maxConcurrent}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleConcurrentChange(n)}
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          maxConcurrent === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <SaveButton />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Keys & Accounts */}
      {activeTab === "credentials" && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />Loading…
            </div>
          ) : (
            <>
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div>
                    <p className="text-sm font-medium">TMDB API key</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Required for Identify & Rename. Free key at{" "}
                      <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-primary underline">
                        themoviedb.org
                      </a>.
                    </p>
                  </div>
                  <input
                    type="password"
                    value={tmdbKey}
                    onChange={(e) => { setTmdbKey(e.target.value); markDirty(); }}
                    placeholder="Paste your TMDB API key…"
                    className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div>
                    <p className="text-sm font-medium">OpenSubtitles.org account</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Required for Subtitles. Free account at{" "}
                      <a href="https://www.opensubtitles.org" target="_blank" rel="noreferrer" className="text-primary underline">
                        opensubtitles.org
                      </a>{" "}— 200 downloads/day.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={osUsername}
                      onChange={(e) => { setOsUsername(e.target.value); markDirty(); }}
                      placeholder="Username"
                      autoComplete="off"
                      className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="password"
                      value={osPassword}
                      onChange={(e) => { setOsPassword(e.target.value); markDirty(); }}
                      placeholder="Password"
                      autoComplete="new-password"
                      className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Default subtitle languages</p>
                    <div className="flex flex-wrap gap-1.5">
                      {COMMON_LANGS.map(({ code, label }) => {
                        const active = subtitleLangs.includes(code);
                        return (
                          <button
                            key={code}
                            onClick={() => {
                              setSubtitleLangs((prev) =>
                                prev.includes(code)
                                  ? prev.length > 1 ? prev.filter((c) => c !== code) : prev
                                  : [...prev, code]
                              );
                              markDirty();
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                              active
                                ? "bg-primary/15 border-primary/40 text-primary"
                                : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <SaveButton />
            </>
          )}
        </div>
      )}

      {/* AI Models */}
      {activeTab === "ai" && (
        <div className="space-y-6">
          {/* Keyframes per video */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium">Max keyframes per video</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many frames to sample per video for NudeNet content detection. More frames = better coverage across the video. CLIP always uses 3 frames from the midpoint regardless of this setting.
                </p>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading…
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={4}
                      max={64}
                      step={4}
                      value={videoKeyframesPerVideo}
                      onChange={(e) => { setVideoKeyframesPerVideo(Number(e.target.value)); markDirty(); }}
                      className="w-48 accent-primary"
                    />
                    <span className="text-sm font-mono w-12 text-right">{videoKeyframesPerVideo} frames</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[8, 16, 24, 32].map((n) => (
                      <button
                        key={n}
                        onClick={() => { setVideoKeyframesPerVideo(n); markDirty(); }}
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          videoKeyframesPerVideo === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <SaveButton />
                </>
              )}
            </CardContent>
          </Card>

          {/* Scan batch size */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium">Scan batch size</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many images (or video keyframes) to process in a single CLIP/NudeNet inference pass. Higher values use more VRAM but scan faster.
                </p>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading…
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={32}
                      value={scanBatchSize}
                      onChange={(e) => { setScanBatchSize(Number(e.target.value)); markDirty(); }}
                      className="w-48 accent-primary"
                    />
                    <span className="text-sm font-mono w-16 text-right">{scanBatchSize} images</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[1, 4, 8, 16].map((n) => (
                      <button
                        key={n}
                        onClick={() => { setScanBatchSize(n); markDirty(); }}
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          scanBatchSize === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <SaveButton />
                </>
              )}
            </CardContent>
          </Card>

          {/* Scan prefetch */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium">Scan prefetch</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Videos (or image batches) to pre-load into memory while the AI models process the current one. Overlaps disk reads with GPU inference. Higher values use more RAM but keep the GPU continuously fed.
                </p>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading…
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={scanPrefetch}
                      onChange={(e) => { setScanPrefetch(Number(e.target.value)); markDirty(); }}
                      className="w-48 accent-primary"
                    />
                    <span className="text-sm font-mono w-4 text-center">{scanPrefetch}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[2, 4, 8, 16].map((n) => (
                      <button
                        key={n}
                        onClick={() => { setScanPrefetch(n); markDirty(); }}
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          scanPrefetch === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <SaveButton />
                </>
              )}
            </CardContent>
          </Card>

          {/* Model lists */}
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />Loading models…
            </div>
          ) : (
            <>
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div>
                    <p className="text-sm font-medium">Semantic Search (CLIP)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Used when scanning images and videos. Larger models improve accuracy but require more RAM.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {clipModels.map((m) => (
                      <ModelCard key={m.id} model={m} onAction={reloadModels} activeDownload={activeDownload} />
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div>
                    <p className="text-sm font-medium">Content Detection (NudeNet)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Used when scanning images and videos. Higher resolution models catch smaller or partial detections.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {nudenetModels.map((m) => (
                      <ModelCard key={m.id} model={m} onAction={reloadModels} activeDownload={activeDownload} />
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div>
                    <p className="text-sm font-medium">Speech-to-Text (Whisper)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Generates subtitle files locally from video audio. No API key required. Larger models are slower but more accurate.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {whisperModels.map((m) => (
                      <ModelCard key={m.id} model={m} onAction={reloadModels} activeDownload={activeDownload} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Downloads */}
      {activeTab === "downloads" && (
        <div className="space-y-4">
          {/* Download Directory */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Default download directory</p>
                <p className="text-xs text-muted-foreground mb-3">Where downloaded files are saved. Can be overridden per download.</p>
                {showDirPicker ? (
                  <DirPicker
                    onSelect={(p) => { setDownloadDir(p); setShowDirPicker(false); markDirty(); }}
                    onClose={() => setShowDirPicker(false)}
                  />
                ) : (
                  <div className="flex gap-2 items-center">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{downloadDir}</code>
                    <Button size="sm" variant="outline" onClick={() => setShowDirPicker(true)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                      Browse
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Max concurrent downloads</p>
                  <span className="text-sm font-mono">{maxConcurrentDownloads}</span>
                </div>
                <input
                  type="range"
                  min={1} max={5} step={1}
                  value={maxConcurrentDownloads}
                  onChange={(e) => { setMaxConcurrentDownloads(Number(e.target.value)); markDirty(); }}
                  className="w-48 accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground w-48 mt-1">
                  <span>1</span><span>5</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* yt-dlp management */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm font-medium">yt-dlp</p>
              {ytdlpInfo === null ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading…
                </div>
              ) : ytdlpInfo.installed ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Version: <span className="font-mono text-foreground">{ytdlpInfo.version}</span></p>
                  <p className="text-xs text-muted-foreground truncate">Path: <span className="font-mono text-foreground">{ytdlpInfo.path}</span></p>
                </div>
              ) : (
                <p className="text-sm text-amber-400">Not installed. Click Install to set it up.</p>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Release channel</p>
                <div className="flex gap-1">
                  {(["stable", "nightly"] as const).map((ch) => (
                    <button
                      key={ch}
                      onClick={() => { setYtdlpChannel(ch); markDirty(); }}
                      className={`px-3 py-1 rounded text-xs border transition-colors capitalize ${
                        ytdlpChannel === ch
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {ytdlpChannel === "nightly" ? "Built nightly from master — latest fixes, may be unstable." : "Latest tagged release — tested and stable."}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={ytdlpUpdating}
                onClick={async () => {
                  setYtdlpUpdating(true);
                  try {
                    await api.ytdlpUpdate();
                    const info = await api.ytdlpInfo();
                    setYtdlpInfo(info);
                  } catch { /* ignore */ } finally {
                    setYtdlpUpdating(false);
                  }
                }}
              >
                {ytdlpUpdating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                {ytdlpInfo?.installed ? "Update yt-dlp" : "Install yt-dlp"}
              </Button>
            </CardContent>
          </Card>
          <SaveButton />
        </div>
      )}

    </div>
  );
}

function DangerZone() {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const handlePurge = async () => {
    setPurging(true);
    setPurgeError(null);
    try {
      await api.purgeLibraryData();
      setConfirmOpen(false);
      navigate("/libraries");
    } catch {
      setPurgeError("Purge failed — check backend logs.");
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <div className="border border-destructive/30 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 text-destructive">
          <OctagonAlert className="h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold">Danger Zone</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Purge all library data</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Removes all libraries, file records, thumbnails, and keyframes from Parallax. Settings and downloaded AI models are kept. Files on disk are not touched.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Purge
          </Button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <OctagonAlert className="h-5 w-5" />
              <h2 className="font-semibold text-base">Purge all library data?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently delete all library records, file metadata, thumbnails, and keyframes from Parallax's database. Your actual media files on disk will not be touched. This cannot be undone.
            </p>
            {purgeError && (
              <p className="text-sm text-destructive">{purgeError}</p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purging}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handlePurge} disabled={purging}>
                {purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Yes, purge everything
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
