import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Palette, KeyRound, Cpu, Clapperboard, Download } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, modelsApi, qk } from "@/lib/api";
import { SectionHeader } from "@/components/SectionHeader";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { TranscodingTab } from "@/components/settings/TranscodingTab";
import { CredentialsTab } from "@/components/settings/CredentialsTab";
import { ModelsTab } from "@/components/settings/ModelsTab";
import { DownloadsTab } from "@/components/settings/DownloadsTab";

const TABS = [
  { id: "general", label: "General", icon: Palette },
  { id: "transcoder", label: "Transcoder", icon: Clapperboard },
  { id: "credentials", label: "Keys & Accounts", icon: KeyRound },
  { id: "ai", label: "AI Models", icon: Cpu },
  { id: "downloads", label: "Downloads", icon: Download },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Settings() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "general";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [encoderFamily, setEncoderFamily] = useState<string>("software");
  const [_concurrentLimitHint, setConcurrentLimitHint] = useState<number | null>(null);
  const [tmdbKey, setTmdbKey] = useState("");
  const [scanBatchSize, setScanBatchSize] = useState(4);
  const [scanPrefetch, setScanPrefetch] = useState(4);
  const [subtitleLangs, setSubtitleLangs] = useState<string[]>(["en"]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [downloadDir, setDownloadDir] = useState("/media/downloads");
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(2);
  const [ytdlpChannel, setYtdlpChannel] = useState<"stable" | "nightly">("stable");
  const [ytdlpUpdating, setYtdlpUpdating] = useState(false);

  const queryClient = useQueryClient();

  const { data: settings, isLoading: loading } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });

  const { data: ytdlpInfo } = useQuery({
    queryKey: qk.ytdlpInfo(),
    queryFn: () => api.ytdlpInfo(),
    enabled: activeTab === "downloads",
  });

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: qk.models(),
    queryFn: () => modelsApi.listModels(),
  });
  const { data: activeDownload = null } = useQuery({
    queryKey: qk.modelActiveDownload(),
    queryFn: () => modelsApi.getActiveDownload(),
  });

  // Seed the editable form fields from fetched settings. Phase 5 replaces this
  // with react-hook-form; until then this is a legit fetch→form sync.
  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaxConcurrent(settings.max_concurrent_transcodes);
    setEncoderFamily(settings.encoder_family ?? "software");
    setConcurrentLimitHint(settings.concurrent_limit_hint ?? null);
    setTmdbKey(settings.tmdb_api_key);
    setScanBatchSize(settings.scan_batch_size ?? 4);
    setScanPrefetch(settings.scan_prefetch ?? 4);
    setSubtitleLangs(
      (settings.subtitle_languages || "en")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    );
    setDownloadDir(settings.download_dir ?? "/media/downloads");
    setMaxConcurrentDownloads(settings.max_concurrent_downloads ?? 2);
    setYtdlpChannel(settings.ytdlp_channel === "nightly" ? "nightly" : "stable");
  }, [settings]);

  const reloadModels = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.models() });
    queryClient.invalidateQueries({ queryKey: qk.modelActiveDownload() });
  }, [queryClient]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };
  const bump =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      markDirty();
    };
  const handleToggleLang = (code: string) => {
    setSubtitleLangs((prev) =>
      prev.includes(code)
        ? prev.length > 1
          ? prev.filter((c) => c !== code)
          : prev
        : [...prev, code],
    );
    markDirty();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({
        max_concurrent_transcodes: maxConcurrent,
        tmdb_api_key: tmdbKey,
        scan_batch_size: scanBatchSize,
        scan_prefetch: scanPrefetch,
        subtitle_languages: subtitleLangs.join(","),
        download_dir: downloadDir,
        max_concurrent_downloads: maxConcurrentDownloads,
        ytdlp_channel: ytdlpChannel,
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleYtdlpUpdate = async () => {
    setYtdlpUpdating(true);
    try {
      await api.ytdlpUpdate();
      await queryClient.invalidateQueries({ queryKey: qk.ytdlpInfo() });
    } catch {
      /* ignore */
    } finally {
      setYtdlpUpdating(false);
    }
  };

  const nudenetModels = models.filter((m) => m.type === "nudenet");
  const whisperModels = models.filter((m) => m.type === "whisper");
  const save = { saving, saved, dirty, onSave: handleSave };

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

      {activeTab === "general" && <GeneralTab />}

      {activeTab === "transcoder" && (
        <TranscodingTab
          loading={loading}
          maxConcurrent={maxConcurrent}
          encoderFamily={encoderFamily}
          onConcurrentChange={bump(setMaxConcurrent)}
          save={save}
        />
      )}

      {activeTab === "credentials" && (
        <CredentialsTab
          loading={loading}
          tmdbKey={tmdbKey}
          onTmdbKeyChange={bump(setTmdbKey)}
          subtitleLangs={subtitleLangs}
          onToggleLang={handleToggleLang}
          save={save}
        />
      )}

      {activeTab === "ai" && (
        <ModelsTab
          loading={loading}
          modelsLoading={modelsLoading}
          scanBatchSize={scanBatchSize}
          onScanBatchSizeChange={bump(setScanBatchSize)}
          scanPrefetch={scanPrefetch}
          onScanPrefetchChange={bump(setScanPrefetch)}
          nudenetModels={nudenetModels}
          whisperModels={whisperModels}
          activeDownload={activeDownload}
          reloadModels={reloadModels}
          save={save}
        />
      )}

      {activeTab === "downloads" && (
        <DownloadsTab
          ytdlpInfo={ytdlpInfo}
          downloadDir={downloadDir}
          onDownloadDirChange={bump(setDownloadDir)}
          maxConcurrentDownloads={maxConcurrentDownloads}
          onMaxConcurrentDownloadsChange={bump(setMaxConcurrentDownloads)}
          ytdlpChannel={ytdlpChannel}
          onYtdlpChannelChange={bump(setYtdlpChannel)}
          ytdlpUpdating={ytdlpUpdating}
          onYtdlpUpdate={handleYtdlpUpdate}
          save={save}
        />
      )}
    </div>
  );
}
