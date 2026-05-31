import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Check, Palette, KeyRound, Cpu, Download, Trash2, AlertCircle, OctagonAlert } from "lucide-react";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, modelsApi, ModelInfo } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { SectionHeader } from "@/components/SectionHeader";
import { formatSize } from "@/lib/format";

const THEMES = [
  { id: "violet" as const, label: "Deep Space",      accent: "#a78bfa" },
  { id: "cyan"   as const, label: "Modern HUD",      accent: "#22d3ee" },
  { id: "amber"  as const, label: "Mission Control", accent: "#f59e0b" },
];

const TABS = [
  { id: "appearance",   label: "Appearance",      icon: Palette },
  { id: "transcoder",   label: "Transcoder",      icon: null },
  { id: "credentials",  label: "Keys & Accounts", icon: KeyRound },
  { id: "ai",           label: "AI Models",       icon: Cpu },
] as const;

type TabId = typeof TABS[number]["id"];

function ModelCard({ model, onAction }: { model: ModelInfo; onAction: () => void }) {
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
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "appearance";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const [maxConcurrent, setMaxConcurrent]         = useState(1);
  const [tmdbKey, setTmdbKey]                     = useState("");
  const [videoKeyframesPerVideo, setVideoKeyframesPerVideo] = useState(8);
  const [scanBatchSize, setScanBatchSize]                   = useState(4);
  const [osUsername, setOsUsername]               = useState("");
  const [osPassword, setOsPassword]               = useState("");
  const [subtitleLangs, setSubtitleLangs]         = useState<string[]>(["en"]);
  const [loading, setLoading]                     = useState(true);
  const [saving, setSaving]                       = useState(false);
  const [saved, setSaved]                         = useState(false);
  const [dirty, setDirty]                         = useState(false);

  const [models, setModels]             = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setMaxConcurrent(s.max_concurrent_transcodes);
        setTmdbKey(s.tmdb_api_key);
        setVideoKeyframesPerVideo(s.video_keyframes_per_video ?? 8);
        setScanBatchSize(s.scan_batch_size ?? 4);
        setOsUsername(s.opensubtitles_username ?? "");
        setOsPassword(s.opensubtitles_password ?? "");
        setSubtitleLangs((s.subtitle_languages || "en").split(",").map((c) => c.trim()).filter(Boolean));
      })
      .finally(() => setLoading(false));
  }, []);

  const reloadModels = useCallback(() => {
    setModelsLoading(true);
    modelsApi.listModels().then(setModels).catch(() => {}).finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => { reloadModels(); }, [reloadModels]);

  const markDirty = () => { setDirty(true); setSaved(false); };
  const handleConcurrentChange = (n: number) => { setMaxConcurrent(n); markDirty(); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ max_concurrent_transcodes: maxConcurrent, tmdb_api_key: tmdbKey, video_keyframes_per_video: videoKeyframesPerVideo, scan_batch_size: scanBatchSize, opensubtitles_username: osUsername, opensubtitles_password: osPassword, subtitle_languages: subtitleLangs.join(",") });
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

      {/* Appearance */}
      {activeTab === "appearance" && (
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
                      className={`flex flex-col items-center gap-2 p-3 rounded-[0.4rem] border transition-colors ${
                        isActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="h-8 w-8 rounded-full" style={{ background: t.accent }} />
                      <span className="text-xs font-medium whitespace-nowrap">{t.label}</span>
                      {isActive && <Check className="h-3 w-3 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
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
                      How many files to transcode in parallel. Higher values use more CPU/GPU but finish queues faster.
                      Changes apply to jobs that haven't started yet.
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
                <p className="text-sm font-medium">Keyframes per video</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many frames to extract per video, evenly spaced across its duration. Frames are saved to disk and reused across scans.
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
                      max={50}
                      value={videoKeyframesPerVideo}
                      onChange={(e) => { setVideoKeyframesPerVideo(Number(e.target.value)); markDirty(); }}
                      className="w-48 accent-primary"
                    />
                    <span className="text-sm font-mono w-12 text-right">{videoKeyframesPerVideo} frames</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[4, 8, 16, 24].map((n) => (
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
                      <ModelCard key={m.id} model={m} onAction={reloadModels} />
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
                      <ModelCard key={m.id} model={m} onAction={reloadModels} />
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
                      <ModelCard key={m.id} model={m} onAction={reloadModels} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      <DangerZone />
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
