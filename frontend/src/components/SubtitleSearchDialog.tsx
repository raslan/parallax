import { useState, useEffect } from "react";
import { Loader2, Download, CheckCircle2, Volume2, VolumeX } from "lucide-react";
import { subtitlesApi, SubtitleCandidate, SubtitleFile } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LANG_NAMES: Record<string, string> = {
  en: "English", fr: "French", de: "German", es: "Spanish", pt: "Portuguese",
  it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian", ja: "Japanese",
  ko: "Korean", zh: "Chinese", ar: "Arabic", sv: "Swedish", da: "Danish",
  fi: "Finnish", nb: "Norwegian", tr: "Turkish",
};

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-muted-foreground/40")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-6 text-right">{pct}</span>
    </div>
  );
}

interface Props {
  file: SubtitleFile;
  languages: string[];
  onClose: () => void;
  onDownloaded: () => void;
}

export function SubtitleSearchDialog({ file, languages, onClose, onDownloaded }: Props) {
  const [searching, setSearching] = useState(true);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  useEffect(() => {
    subtitlesApi.searchFile(file.path, languages)
      .then(setCandidates)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => setSearching(false));
  }, [file.path, languages]);

  const handleDownload = async (c: SubtitleCandidate) => {
    const key = `${c.provider}:${c.subtitle_id}`;
    setDownloadingId(key);
    try {
      await subtitlesApi.downloadOne(file.path, c.provider, c.subtitle_id, c.language);
      setDownloaded((prev) => new Set(prev).add(key));
      onDownloaded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const maxScore = candidates.length ? Math.max(...candidates.map((c) => c.score), 1) : 1;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" onClose={onClose}>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm truncate pr-6">{file.filename}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {searching ? "Searching…" : `${candidates.length} subtitle${candidates.length !== 1 ? "s" : ""} found`}
          </p>
        </DialogHeader>

        {searching && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <p className="text-sm text-destructive py-4">{error}</p>}

        {!searching && candidates.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-8 text-center">No subtitles found for this file.</p>
        )}

        {candidates.length > 0 && (
          <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-1">
            {candidates.map((c) => {
              const key = `${c.provider}:${c.subtitle_id}`;
              const isDone = downloaded.has(key);
              const isLoading = downloadingId === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                    isDone ? "border-green-500/30 bg-green-500/5" : "border-border hover:bg-muted/30"
                  )}
                >
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-primary/15 text-primary">
                    {c.provider.slice(0, 4).toUpperCase()}
                  </span>

                  <span className="text-xs font-medium shrink-0 w-8 text-muted-foreground">
                    {LANG_NAMES[c.language] ? c.language.toUpperCase() : c.language}
                  </span>

                  <span className="flex-1 text-xs text-muted-foreground truncate" title={c.release}>
                    {c.release}
                  </span>

                  {c.hearing_impaired
                    ? <span title="Hearing impaired"><VolumeX className="h-3 w-3 text-muted-foreground/50 shrink-0" /></span>
                    : <Volume2 className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                  }

                  <ScoreBar score={c.score} max={maxScore} />

                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 shrink-0"
                      disabled={!!downloadingId}
                      onClick={() => handleDownload(c)}
                      title="Download this subtitle"
                    >
                      {isLoading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Download className="h-3.5 w-3.5" />
                      }
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
