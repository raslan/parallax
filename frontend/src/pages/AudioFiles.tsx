import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Film, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { audioFilesApi, audioLibrariesApi, qk } from "@/lib/api";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { LibraryBar } from "@/components/LibraryBar";
import { applySortDir, FileListRow, type SortDir } from "@/components/FileSelectGrid";
import { useSort } from "@/hooks/useSort";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { formatSize, formatDuration, formatBitrate, formatUnixDate } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── List row ────────────────────────────────────────────────────────────────

function AudioFileColumns({ file }: { file: AudioFile }) {
  return (
    <>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {file.codec_name ? file.codec_name.toUpperCase() : "—"}
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {formatDuration(file.duration)}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {file.bitrate ? formatBitrate(file.bitrate) : "—"}
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {formatUnixDate(file.file_date)}
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {formatUnixDate(file.file_mtime)}
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
        {formatSize(file.size)}
      </span>
    </>
  );
}

function AudioFileListHeader() {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider rounded-t-lg">
      <div className="w-8 shrink-0" />
      <div className="flex-1">Filename</div>
      <div className="w-16 shrink-0 text-right">Codec</div>
      <div className="w-16 shrink-0 text-right">Duration</div>
      <div className="w-20 shrink-0 text-right">Bitrate</div>
      <div className="w-24 shrink-0 text-right">Content date</div>
      <div className="w-24 shrink-0 text-right">File added</div>
      <div className="w-16 shrink-0 text-right">Size</div>
    </div>
  );
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

type SortKey = "filename" | "size" | "duration" | "bitrate" | "file_date";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "filename", label: "Filename" },
  { value: "size", label: "Size" },
  { value: "duration", label: "Duration" },
  { value: "bitrate", label: "Bitrate" },
  { value: "file_date", label: "Date" },
];

function sortAudioFiles(files: AudioFile[], key: SortKey, dir: SortDir): AudioFile[] {
  const sorted = [...files].sort((a, b) => {
    let va: number | string, vb: number | string;
    switch (key) {
      case "filename":
        va = a.filename.toLowerCase();
        vb = b.filename.toLowerCase();
        break;
      case "size":
        va = a.size;
        vb = b.size;
        break;
      case "duration":
        va = a.duration ?? 0;
        vb = b.duration ?? 0;
        break;
      case "bitrate":
        va = a.bitrate ?? 0;
        vb = b.bitrate ?? 0;
        break;
      case "file_date":
        va = a.file_date ?? 0;
        vb = b.file_date ?? 0;
        break;
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function AudioFiles() {
  const qc = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const { sortKey, setSortKey, sortDir, setSortDir } = useSort<SortKey>("filename");
  const [playing, setPlaying] = useState<AudioFile | null>(null);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
  });

  useEffect(() => {
    if (libraryId == null && libraries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLibraryId(libraries[0]!.id);
    }
  }, [libraries, libraryId]);

  const { data: files = null, isLoading: loading } = useQuery({
    queryKey: qk.audioFiles(libraryId ?? -1),
    queryFn: () => audioFilesApi.list(libraryId as number),
    enabled: libraryId != null,
  });

  useLiveFiles("audio", libraryId, () => {
    if (libraryId != null) qc.invalidateQueries({ queryKey: qk.audioFiles(libraryId) });
  });

  const sortedFiles = useMemo(
    () => (files ? sortAudioFiles(files, sortKey, sortDir) : []),
    [files, sortKey, sortDir],
  );

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and play the audio files in this library.
        </p>
      </div>

      <LibraryBar libraries={libraries} libraryId={libraryId} onLibraryChange={setLibraryId} />

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1 ml-auto">
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-8 w-[9rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {libraryId == null ? (
          <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
            {libraries.length === 0
              ? "No audio libraries yet — add one on the Libraries page"
              : "Select a library"}
          </div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sortedFiles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Film className="h-10 w-10 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-1">No files found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Add a library and run a scan to populate this view.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="h-full flex flex-col gap-3">
            <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border overflow-hidden">
              <AudioFileListHeader />
              <div className="flex-1 min-h-0">
                <VirtualizedGrid
                  items={sortedFiles}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={54}
                  dynamicHeight
                  resetKey={`${libraryId}-${sortKey}-${sortDir}`}
                  renderItem={(f) => (
                    <FileListRow
                      file={f}
                      selectable={false}
                      clickAction="play"
                      selected={false}
                      onToggle={() => {}}
                      onPlay={() => setPlaying(f)}
                      columns={<AudioFileColumns file={f} />}
                    />
                  )}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {playing && (
        <VideoPlayerModal
          file={playing}
          streamUrl={audioFilesApi.streamUrl(playing.id)}
          isAudio
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
