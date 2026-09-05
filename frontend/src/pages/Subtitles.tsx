import { useState, useEffect, useRef } from "react";
import {
  Captions,
  FolderOpen,
  ScanLine,
  Download,
  Loader2,
  ChevronRight,
  Film,
  Globe,
  Search,
  Play,
  Mic,
  X,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { subtitlesApi, api, qk } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import type { SubtitleFile } from "@/types/subtitle";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { SubtitleSearchDialog } from "@/components/SubtitleSearchDialog";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirPicker } from "@/components/DirPicker";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByDir(files: SubtitleFile[]): Map<string, SubtitleFile[]> {
  const map = new Map<string, SubtitleFile[]>();
  for (const f of files) {
    const key = f.relative_dir || "(root)";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

function episodeLabel(f: SubtitleFile): string {
  if (f.season != null && f.episode != null)
    return `S${String(f.season).padStart(2, "0")}E${String(f.episode).padStart(2, "0")}`;
  if (f.year) return String(f.year);
  return "";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function LangBadges({
  languages,
  onDelete,
}: {
  languages: Record<string, boolean>;
  onDelete: (code: string) => void;
}) {
  const codes = Object.keys(languages);
  if (codes.length === 0) return null;
  return (
    <div className="flex items-center gap-1 shrink-0">
      {codes.map((code) =>
        languages[code] ? (
          <span
            key={code}
            title={`${code}: present — click × to remove`}
            className="group/badge flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase leading-none bg-green-500/15 text-green-500"
          >
            {code}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(code);
              }}
              title={`Delete ${code} subtitle`}
              className="opacity-0 group-hover/badge:opacity-100 transition-opacity rounded hover:bg-green-500/20"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ) : (
          <span
            key={code}
            title={`${code}: missing`}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase leading-none bg-muted/50 text-muted-foreground/40"
          >
            {code}
          </span>
        ),
      )}
    </div>
  );
}

function FileRow({
  file,
  syncing,
  syncDisabled,
  onSearch,
  onPlay,
  onGenerate,
  onSync,
  onDeleteLang,
}: {
  file: SubtitleFile;
  syncing: boolean;
  syncDisabled: boolean;
  onSearch: () => void;
  onPlay: () => void;
  onGenerate: () => void;
  onSync: () => void;
  onDeleteLang: (code: string) => void;
}) {
  const label = episodeLabel(file);
  const hasAny = Object.values(file.languages).some(Boolean);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
      <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <span
        className="flex-1 text-sm font-mono truncate text-muted-foreground"
        title={file.filename}
      >
        {file.filename}
      </span>
      {label && (
        <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">{label}</span>
      )}
      <LangBadges languages={file.languages} onDelete={onDeleteLang} />
      <button
        onClick={onSearch}
        title="Search subtitles"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onGenerate}
        title="Generate subtitle with Whisper"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
      >
        <Mic className="h-3.5 w-3.5" />
      </button>
      {hasAny && (
        <button
          onClick={onSync}
          disabled={syncing || syncDisabled}
          title="Sync subtitle timing to audio"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50 disabled:opacity-100"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
        </button>
      )}
      {hasAny && (
        <button
          onClick={onPlay}
          title="Preview with subtitle"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function DirGroup({
  dir,
  files,
  syncingPaths,
  syncDisabled,
  onSearch,
  onPlay,
  onGenerate,
  onSync,
  onDeleteLang,
}: {
  dir: string;
  files: SubtitleFile[];
  syncingPaths: Set<string>;
  syncDisabled: boolean;
  onSearch: (f: SubtitleFile) => void;
  onPlay: (f: SubtitleFile) => void;
  onGenerate: (f: SubtitleFile) => void;
  onSync: (f: SubtitleFile) => void;
  onDeleteLang: (f: SubtitleFile, code: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const withSub = files.filter((f) => f.has_subtitle).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
        <span className="flex-1 text-sm font-mono truncate">{dir}</span>
        <span
          className={cn(
            "text-xs shrink-0 font-medium",
            withSub === files.length
              ? "text-green-500"
              : withSub === 0
                ? "text-muted-foreground/50"
                : "text-amber-500",
          )}
        >
          {withSub}/{files.length}
        </span>
      </button>
      {open && (
        <div>
          {files.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              syncing={syncingPaths.has(f.path)}
              syncDisabled={syncDisabled}
              onSearch={() => onSearch(f)}
              onPlay={() => onPlay(f)}
              onGenerate={() => onGenerate(f)}
              onSync={() => onSync(f)}
              onDeleteLang={(code) => onDeleteLang(f, code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Subtitles() {
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<SubtitleFile[] | null>(null);
  const [scanError, setScanError] = useState("");

  const [selectedLangs, setSelectedLangs] = useState<string[]>(["en"]);
  const [searchFile, setSearchFile] = useState<SubtitleFile | null>(null);
  const [playingFile, setPlayingFile] = useState<SubtitleFile | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [syncingPaths, setSyncingPaths] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const syncAllTargetRef = useRef("");
  const downloadTargetRef = useRef("");
  const transcribeTargetRef = useRef("");

  const downloadPoll = useJobPoll({
    intervalMs: 2000,
    onTerminal: () => {
      setDownloading(false);
      const target = downloadTargetRef.current;
      if (target)
        subtitlesApi
          .scan(target)
          .then(setFiles)
          .catch(() => {});
    },
  });
  const transcribePoll = useJobPoll({
    intervalMs: 2000,
    onTerminal: () => {
      setTranscribing(false);
      const target = transcribeTargetRef.current;
      if (target)
        subtitlesApi
          .scan(target)
          .then(setFiles)
          .catch(() => {});
    },
  });
  const syncAllPoll = useJobPoll({
    intervalMs: 2000,
    onTerminal: () => {
      setSyncingAll(false);
      const target = syncAllTargetRef.current;
      if (target)
        subtitlesApi
          .scan(target)
          .then(setFiles)
          .catch(() => {});
    },
  });
  const jobProgress = downloadPoll.progress;
  const jobStatus = downloadPoll.currentFile || downloadPoll.status || "";
  const transcribeProgress = transcribePoll.progress;
  const transcribeStatus = transcribePoll.currentFile || transcribePoll.status || "";
  const syncAllProgress = syncAllPoll.progress;
  const syncAllStatus = syncAllPoll.currentFile || syncAllPoll.status || "";

  // Load default languages from settings
  const { data: settings } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => api.getSettings(),
  });
  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedLangs(
      (settings.subtitle_languages || "en")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    );
  }, [settings]);

  const toggleLang = (code: string) => {
    setSelectedLangs((prev) =>
      prev.includes(code)
        ? prev.length > 1
          ? prev.filter((c) => c !== code)
          : prev // keep at least one
        : [...prev, code],
    );
  };

  const handleGenerateFile = async (file: SubtitleFile) => {
    setTranscribing(true);
    transcribeTargetRef.current = path.trim();
    try {
      const { job_id } = await subtitlesApi.transcribeFile(file.path);
      transcribePoll.start(job_id);
    } catch (e: unknown) {
      setTranscribing(false);
      setScanError(e instanceof Error ? e.message : "Transcription failed");
    }
  };

  const handleDeleteLang = async (file: SubtitleFile, code: string) => {
    try {
      await subtitlesApi.deleteSubtitle(file.path, code);
      setFiles((prev) =>
        prev
          ? prev.map((f) =>
              f.path === file.path
                ? {
                    ...f,
                    languages: { ...f.languages, [code]: false },
                    has_subtitle: Object.entries(f.languages).some(
                      ([c, present]) => c !== code && present,
                    ),
                  }
                : f,
            )
          : prev,
      );
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleSyncFile = async (file: SubtitleFile) => {
    setSyncingPaths((prev) => new Set(prev).add(file.path));
    try {
      const { job_id } = await subtitlesApi.syncFile(file.path);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await api.getJob(job_id);
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          break;
        }
      }
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingPaths((prev) => {
        const next = new Set(prev);
        next.delete(file.path);
        return next;
      });
    }
  };

  const handleSyncAll = async () => {
    if (!path.trim()) return;
    setSyncingAll(true);
    syncAllTargetRef.current = path.trim();
    try {
      const { job_id } = await subtitlesApi.syncBulk(path.trim());
      syncAllPoll.start(job_id);
    } catch (e: unknown) {
      setSyncingAll(false);
      setScanError(e instanceof Error ? e.message : "Sync failed");
    }
  };

  const handleGenerateAll = async () => {
    if (!path.trim()) return;
    setTranscribing(true);
    transcribeTargetRef.current = path.trim();
    try {
      const { job_id } = await subtitlesApi.transcribeBulk(path.trim());
      transcribePoll.start(job_id);
    } catch (e: unknown) {
      setTranscribing(false);
      setScanError(e instanceof Error ? e.message : "Transcription failed");
    }
  };

  const handleScan = async (scanPath?: string) => {
    const target = (scanPath ?? path).trim();
    if (!target) return;
    setScanning(true);
    setScanError("");
    setFiles(null);
    try {
      const result = await subtitlesApi.scan(target);
      setFiles(result);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleFolderSelect = (p: string) => {
    setPath(p);
    setPicking(false);
    handleScan(p);
  };

  const handleDownload = async () => {
    if (!path.trim()) return;
    setDownloading(true);
    downloadTargetRef.current = path.trim();

    try {
      const { job_id } = await subtitlesApi.download(path.trim(), selectedLangs);
      downloadPoll.start(job_id);
    } catch (e: unknown) {
      setDownloading(false);
      setScanError(e instanceof Error ? e.message : "Download failed");
    }
  };

  // Resume an active bulk job on mount (e.g. after a refresh)
  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (!allJobs) return;
    const bulkTypes = new Set(["subtitle_download", "whisper_transcribe", "subtitle_sync"]);
    const active = allJobs.find(
      (j) => bulkTypes.has(j.type) && (j.status === "running" || j.status === "pending"),
    );
    if (!active) return;

    let jobPath = "";
    try {
      jobPath = active.settings ? (JSON.parse(active.settings).path ?? "") : "";
    } catch {
      /* ignore malformed settings */
    }
    if (!jobPath) return;

    /* eslint-disable react-hooks/set-state-in-effect */
    setPath(jobPath);
    handleScan(jobPath);
    if (active.type === "subtitle_download") {
      setDownloading(true);
      downloadTargetRef.current = jobPath;
      downloadPoll.resume(allJobs, (j) => j.id === active.id);
    } else if (active.type === "whisper_transcribe") {
      setTranscribing(true);
      transcribeTargetRef.current = jobPath;
      transcribePoll.resume(allJobs, (j) => j.id === active.id);
    } else {
      setSyncingAll(true);
      syncAllTargetRef.current = jobPath;
      syncAllPoll.resume(allJobs, (j) => j.id === active.id);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const groups = files ? groupByDir(files) : null;
  const totalFiles = files?.length ?? 0;
  const withSub = files?.filter((f) => f.has_subtitle).length ?? 0;
  const missing = totalFiles - withSub;
  const withAnySub = files?.filter((f) => f.has_any_subtitle).length ?? 0;

  const handleSearchDownloaded = async () => {
    if (!path.trim()) return;
    const result = await subtitlesApi.scan(path.trim()).catch(() => null);
    if (result) setFiles(result);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      {searchFile && (
        <SubtitleSearchDialog
          file={searchFile}
          languages={selectedLangs}
          onClose={() => setSearchFile(null)}
          onDownloaded={handleSearchDownloaded}
        />
      )}
      {playingFile && (
        <VideoPlayerModal
          file={{ id: 0, filename: playingFile.filename, path: playingFile.path }}
          streamUrl={subtitlesApi.streamUrl(playingFile.path)}
          subtitleTracksUrl={subtitlesApi.tracksUrl(playingFile.path)}
          onClose={() => setPlayingFile(null)}
        />
      )}
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subtitles</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download and match subtitle files for a folder of videos.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          <Mic className="h-3 w-3 inline mr-1 opacity-60" />
          Whisper generates subtitles in the video's spoken language regardless of the language
          selection above. Download uses the selection.
        </p>
      </div>

      {/* Path input */}
      <div className="flex gap-2 max-w-2xl">
        {picking ? (
          <div className="flex-1">
            <DirPicker onSelect={handleFolderSelect} onClose={() => setPicking(false)} />
          </div>
        ) : (
          <>
            <Input
              placeholder="/media/shows/Breaking Bad"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="font-mono text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
            />
            <Button variant="outline" size="icon" onClick={() => setPicking(true)} title="Browse">
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleScan()}
              disabled={scanning || !path.trim()}
              title="Rescan"
            >
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
            </Button>
          </>
        )}
      </div>

      {/* Language picker */}
      <div className="space-y-2 max-w-2xl">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Languages
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_LANGS.map(({ code, label }) => {
            const active = selectedLangs.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleLang(code)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {selectedLangs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Downloading:{" "}
            {selectedLangs
              .map((c) => COMMON_LANGS.find((l) => l.code === c)?.label ?? c)
              .join(", ")}
          </p>
        )}
      </div>

      {scanError && <p className="text-sm text-destructive">{scanError}</p>}

      {/* Results */}
      {files && (
        <div className="space-y-4">
          {/* Summary + action bar */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                <span className="font-mono font-medium text-foreground">{totalFiles}</span> files
              </span>
              <span className="text-green-500">
                <span className="font-mono font-medium">{withSub}</span> have subtitles
              </span>
              {missing > 0 && (
                <span className="text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">{missing}</span> missing
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {downloading && jobProgress !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate max-w-xs" title={jobStatus}>
                    {Math.round(jobProgress)}% · {jobStatus}
                  </span>
                </div>
              )}
              {transcribing && transcribeProgress !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate max-w-xs" title={transcribeStatus}>
                    {Math.round(transcribeProgress)}% · {transcribeStatus}
                  </span>
                </div>
              )}
              {syncingAll && syncAllProgress !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate max-w-xs" title={syncAllStatus}>
                    {Math.round(syncAllProgress)}% · {syncAllStatus}
                  </span>
                </div>
              )}
              <Button
                onClick={handleSyncAll}
                disabled={
                  syncingAll ||
                  syncingPaths.size > 0 ||
                  downloading ||
                  transcribing ||
                  withAnySub === 0
                }
                variant="outline"
                title="Sync every existing subtitle in this library to its video's audio"
              >
                {syncingAll ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {withAnySub === 0
                  ? "No subtitles to sync"
                  : `Sync ${withAnySub} file${withAnySub === 1 ? "" : "s"}`}
              </Button>
              <Button
                onClick={handleGenerateAll}
                disabled={transcribing || downloading || missing === 0}
                variant="outline"
              >
                {transcribing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4 mr-2" />
                )}
                {missing === 0 ? "All subtitles present" : `Generate ${missing} missing`}
              </Button>
              <Button
                onClick={handleDownload}
                disabled={downloading || transcribing || missing === 0}
                variant={missing === 0 ? "outline" : "default"}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {missing === 0 ? "All subtitles present" : `Download ${missing} missing`}
              </Button>
            </div>
          </div>

          {/* File tree */}
          {groups && groups.size > 0 ? (
            <div className="space-y-2">
              {[...groups.entries()].map(([dir, dirFiles]) => (
                <DirGroup
                  key={dir}
                  dir={dir}
                  files={dirFiles}
                  syncingPaths={syncingPaths}
                  syncDisabled={syncingAll}
                  onSearch={setSearchFile}
                  onPlay={setPlayingFile}
                  onGenerate={handleGenerateFile}
                  onSync={handleSyncFile}
                  onDeleteLang={handleDeleteLang}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg">
              <Captions className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No video files found in this directory.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state before any scan */}
      {!files && !scanning && (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-lg">
          <Captions className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            Enter a folder path and click Scan to see subtitle status.
          </p>
        </div>
      )}
    </div>
  );
}
