import { useState, useEffect, useRef } from "react";
import {
  Captions, FolderOpen, ScanLine, Download, CheckCircle2,
  XCircle, Loader2, ChevronRight, Film, Globe, Search, Settings, Play,
} from "lucide-react";
import { subtitlesApi, SubtitleFile, api } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { SubtitleSearchDialog } from "@/components/SubtitleSearchDialog";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirPicker } from "@/components/DirPicker";
import { SectionHeader } from "@/components/SectionHeader";
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

function FileRow({ file, onSearch, onPlay }: { file: SubtitleFile; onSearch: () => void; onPlay: () => void }) {
  const label = episodeLabel(file);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
      <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <span className="flex-1 text-sm font-mono truncate text-muted-foreground" title={file.filename}>
        {file.filename}
      </span>
      {label && (
        <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">{label}</span>
      )}
      <button
        onClick={onSearch}
        title="Search subtitles"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      {file.has_subtitle && (
        <button
          onClick={onPlay}
          title="Preview with subtitle"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
      {file.has_subtitle ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}
    </div>
  );
}

function DirGroup({ dir, files, onSearch, onPlay }: { dir: string; files: SubtitleFile[]; onSearch: (f: SubtitleFile) => void; onPlay: (f: SubtitleFile) => void }) {
  const [open, setOpen] = useState(true);
  const withSub = files.filter((f) => f.has_subtitle).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
        <span className="flex-1 text-sm font-mono truncate">{dir}</span>
        <span className={cn(
          "text-xs shrink-0 font-medium",
          withSub === files.length ? "text-green-500" : withSub === 0 ? "text-muted-foreground/50" : "text-amber-500"
        )}>
          {withSub}/{files.length}
        </span>
      </button>
      {open && (
        <div>
          {files.map((f) => <FileRow key={f.path} file={f} onSearch={() => onSearch(f)} onPlay={() => onPlay(f)} />)}
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
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load default languages from settings
  useEffect(() => {
    api.getSettings().then((s) => {
      const codes = (s.subtitle_languages || "en").split(",").map((c) => c.trim()).filter(Boolean);
      setSelectedLangs(codes);
    }).catch(() => {});
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggleLang = (code: string) => {
    setSelectedLangs((prev) =>
      prev.includes(code)
        ? prev.length > 1 ? prev.filter((c) => c !== code) : prev // keep at least one
        : [...prev, code]
    );
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleScan = async () => {
    if (!path.trim()) return;
    setScanning(true);
    setScanError("");
    setFiles(null);
    try {
      const result = await subtitlesApi.scan(path.trim());
      setFiles(result);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleDownload = async () => {
    if (!path.trim()) return;
    setDownloading(true);
    setJobProgress(0);
    setJobStatus("Starting…");

    try {
      const { job_id } = await subtitlesApi.download(path.trim(), selectedLangs);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const jobs = await api.getJobs();
          const job = jobs.find((j) => j.id === job_id);
          if (!job) { stopPolling(); setDownloading(false); return; }

          setJobProgress(job.progress);
          setJobStatus(job.current_file || job.status);

          if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
            stopPolling();
            setDownloading(false);
            setJobProgress(null);
            // Re-scan to refresh subtitle status
            const result = await subtitlesApi.scan(path.trim());
            setFiles(result);
          }
        } catch {
          stopPolling();
          setDownloading(false);
        }
      }, 2000);
    } catch (e: unknown) {
      setDownloading(false);
      setJobProgress(null);
      setScanError(e instanceof Error ? e.message : "Download failed");
    }
  };

  const groups = files ? groupByDir(files) : null;
  const totalFiles = files?.length ?? 0;
  const withSub = files?.filter((f) => f.has_subtitle).length ?? 0;
  const missing = totalFiles - withSub;

  const handleSearchDownloaded = async () => {
    if (!path.trim()) return;
    const result = await subtitlesApi.scan(path.trim()).catch(() => null);
    if (result) setFiles(result);
  };

  return (
    <div className="p-8 space-y-6">
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
        <SectionHeader className="mb-1.5">Tools</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Subtitles</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download and match subtitle files for a folder of videos.
        </p>
        <Link
          to="/settings?tab=credentials"
          className="inline-flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="h-3 w-3" />
          Requires an OpenSubtitles.org account — configure in Settings → Keys &amp; Accounts
        </Link>
      </div>

      {/* Path input */}
      <div className="flex gap-2 max-w-2xl">
        {picking ? (
          <div className="flex-1">
            <DirPicker
              onSelect={(p) => { setPath(p); setPicking(false); }}
              onClose={() => setPicking(false)}
            />
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
            <Button onClick={handleScan} disabled={scanning || !path.trim()}>
              {scanning
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <ScanLine className="h-4 w-4 mr-2" />}
              Scan
            </Button>
          </>
        )}
      </div>

      {/* Language picker */}
      <div className="space-y-2 max-w-2xl">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Languages</span>
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
                    : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {selectedLangs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Downloading: {selectedLangs.map((c) => COMMON_LANGS.find((l) => l.code === c)?.label ?? c).join(", ")}
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

            <div className="flex items-center gap-3">
              {downloading && jobProgress !== null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate max-w-xs" title={jobStatus}>
                    {Math.round(jobProgress)}% · {jobStatus}
                  </span>
                </div>
              )}
              <Button
                onClick={handleDownload}
                disabled={downloading || missing === 0}
                variant={missing === 0 ? "outline" : "default"}
              >
                {downloading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Download className="h-4 w-4 mr-2" />}
                {missing === 0 ? "All subtitles present" : `Download ${missing} missing`}
              </Button>
            </div>
          </div>

          {/* File tree */}
          {groups && groups.size > 0 ? (
            <div className="space-y-2">
              {[...groups.entries()].map(([dir, dirFiles]) => (
                <DirGroup key={dir} dir={dir} files={dirFiles} onSearch={setSearchFile} onPlay={setPlayingFile} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg">
              <Captions className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No video files found in this directory.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state before any scan */}
      {!files && !scanning && (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-lg">
          <Captions className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Enter a folder path and click Scan to see subtitle status.</p>
        </div>
      )}
    </div>
  );
}
