import { useState, useEffect, useMemo } from "react";
import {
  Scissors,
  Loader2,
  Trash2,
  Play,
  LayoutGrid,
  List,
  Check,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, qk } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import type { Library } from "@/types/library";
import type { VideoFile } from "@/types/file";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { GridSizeControl } from "@/components/GridSizeControl";
import { useGridSize } from "@/hooks/useGridSize";
import { formatSize, formatDuration, formatUnixDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { QueryBuilder } from "@/components/QueryBuilder";
import { useQueryBuilder } from "@/hooks/useQueryBuilder";
import { cleanupFields } from "@/lib/cleanupFields";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";

function LibrarySelector({
  libraries,
  selected,
  onChange,
}: {
  libraries: Library[];
  selected: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select
      className="bg-card border border-border text-sm rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      value={selected ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {libraries.map((lib) => (
        <option key={lib.id} value={lib.id}>
          {lib.name}
        </option>
      ))}
    </select>
  );
}

function CleanupCard({
  file,
  isSelected,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  isSelected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <Card
      className={`overflow-hidden cursor-pointer group transition-shadow hover:ring-1 ${isSelected ? "ring-1 ring-primary" : "hover:ring-primary/60"}`}
      onClick={onToggle}
    >
      <div className="aspect-[4/3] bg-muted relative flex items-center justify-center">
        <VideoThumbnail
          fileId={file.id}
          scannedAt={file.scanned_at}
          alt={file.filename}
          imgClassName="w-full h-full object-cover"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title="Toggle selection"
          className={`absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded border-2 flex items-center justify-center transition-opacity ${isSelected ? "opacity-100 bg-primary border-primary" : "opacity-0 group-hover:opacity-100 bg-black/50 border-white/70"}`}
        >
          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          title="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
        >
          <Play className="h-8 w-8 text-white fill-white" />
        </button>
      </div>
      <CardContent
        className="p-2.5 space-y-0.5 border-t border-border"
        style={{ background: "var(--px-bg-elevated)" }}
      >
        <p className="text-xs font-medium truncate" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {file.file_width && file.file_height ? (
            <span className="font-mono">
              {file.file_width}×{file.file_height}
            </span>
          ) : null}
          {file.file_width && file.file_height ? " · " : ""}
          <span className="font-mono">{formatDuration(file.duration)}</span>
          {" · "}
          <span className="font-mono">{formatSize(file.size)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function CleanupListRow({
  file,
  selected,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/20 cursor-pointer transition-colors",
        selected && "bg-primary/5",
      )}
      onClick={onToggle}
    >
      <input
        type="checkbox"
        className="accent-primary h-4 w-4 shrink-0"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="relative group/thumb h-8 w-14 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        title="Play video"
      >
        <VideoThumbnail
          fileId={file.id}
          scannedAt={file.scanned_at}
          alt={file.filename}
          imgClassName="h-8 w-14 object-cover rounded"
          iconClassName="h-3.5 w-3.5 text-muted-foreground/40"
          fallbackClassName="h-8 w-14 bg-muted rounded"
        />
        <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
          <Play className="h-3.5 w-3.5 text-white fill-white" />
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-sm" title={file.filename}>
          {file.filename}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={file.path}>
          {file.path}
        </p>
      </div>
      <span className="text-xs text-muted-foreground font-mono w-20 text-right shrink-0">
        {file.file_width && file.file_height ? `${file.file_width}×${file.file_height}` : "—"}
      </span>
      <span className="text-xs text-muted-foreground font-mono w-14 text-right shrink-0">
        {file.file_fps != null ? file.file_fps.toFixed(2) : "—"}
      </span>
      <span className="text-xs text-muted-foreground font-mono w-16 text-right shrink-0">
        {formatDuration(file.duration)}
      </span>
      <span className="text-xs text-muted-foreground font-mono w-24 text-right shrink-0">
        {formatUnixDate(file.file_date)}
      </span>
      <span className="text-xs text-muted-foreground font-mono w-24 text-right shrink-0">
        {formatUnixDate(file.file_mtime)}
      </span>
      <span className="text-xs text-muted-foreground font-mono w-16 text-right shrink-0">
        {formatSize(file.size)}
      </span>
    </div>
  );
}

export function Cleanup() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate } =
    useQueryBuilder(cleanupFields);

  const { selected, setSelected, toggle: toggleOne, selectAll: selectAllIds } = useSelection();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [gridSize, setGridSize] = useGridSize(180);
  const {
    sortKey: sortBy,
    setSortKey: setSortBy,
    sortDir,
    setSortDir,
  } = useSort<string>("filename");

  const { data: libraries = [] } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
  });

  // Default to the first library once they load.
  useEffect(() => {
    if (selectedId == null && libraries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(libraries[0]!.id);
    }
  }, [libraries, selectedId]);

  const {
    data: allFilesData,
    isLoading: loading,
    error: fetchError,
  } = useQuery({
    queryKey: qk.cleanupFiles(selectedId ?? -1),
    queryFn: () => api.getCleanupFiles(selectedId as number),
    enabled: selectedId != null,
  });
  const allFiles = selectedId == null ? null : (allFilesData ?? null);
  const displayError = error ?? (fetchError ? getErrorMessage(fetchError) : null);

  useLiveFiles("video", selectedId, () => {
    if (selectedId != null) {
      queryClient.invalidateQueries({ queryKey: qk.cleanupFiles(selectedId) });
    }
  });

  const SORT_OPTIONS = [
    { value: "filename", label: "Name" },
    { value: "size", label: "Size" },
    { value: "duration", label: "Duration" },
    { value: "video_bitrate", label: "Bitrate" },
    { value: "file_date", label: "Content date" },
  ] as const;

  const filteredResults = useMemo(() => {
    if (!allFiles) return null;
    return allFiles.filter((f) => evaluate(f));
  }, [allFiles, evaluate]);

  const sortedResults = useMemo(() => {
    if (!filteredResults) return null;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredResults].sort((a, b) => {
      const av = (a[sortBy as keyof VideoFile] ?? "") as unknown;
      const bv = (b[sortBy as keyof VideoFile] ?? "") as unknown;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filteredResults, sortBy, sortDir]);

  const toggleAll = () => {
    if (!sortedResults) return;
    if (selected.size === sortedResults.length) {
      setSelected(new Set());
    } else {
      selectAllIds(sortedResults.map((f) => f.id));
    }
  };

  const handleDelete = async () => {
    if (!selectedId || selected.size === 0 || !allFiles) return;
    if (!confirm(`Move ${selected.size} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteCleanupFiles(selectedId, [...selected]);
      queryClient.setQueryData<VideoFile[]>(qk.cleanupFiles(selectedId), (prev) =>
        prev ? prev.filter((f) => !selected.has(f.id)) : prev,
      );
      setSelected(new Set());
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Delete failed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <SectionHeader className="mb-1.5">Library maintenance</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stack filters to find files matching all conditions, then bulk-delete matches.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {libraries.length > 0 && (
            <LibrarySelector
              libraries={libraries}
              selected={selectedId}
              onChange={(id) => {
                setSelectedId(id);
                setSelected(new Set());
                setError(null);
              }}
            />
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shrink-0">
        <QueryBuilder
          registry={cleanupFields}
          clauses={clauses}
          fieldsByKey={fieldsByKey}
          onAdd={addClause}
          onRemove={removeClause}
          onUpdate={updateClause}
        />
      </div>

      {displayError && <p className="text-sm text-destructive">{displayError}</p>}

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && allFiles === null && !displayError && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">Ready to search</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add a filter above to narrow these files down. All active filters stack — results must
              match every condition.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && sortedResults !== null && sortedResults.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Scissors className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No files match</h3>
            <p className="text-sm text-muted-foreground">Try adjusting the filters.</p>
          </CardContent>
        </Card>
      )}

      {!loading && sortedResults !== null && sortedResults.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center justify-between shrink-0">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums font-mono">
                {sortedResults.length}
              </span>{" "}
              file{sortedResults.length !== 1 ? "s" : ""} match
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary h-4 w-4"
                  checked={selected.size === sortedResults.length && sortedResults.length > 0}
                  onChange={toggleAll}
                />
                Select all
              </label>
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
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
              <div className="flex items-center rounded-md border border-input overflow-hidden">
                <button
                  onClick={() => setViewMode("list")}
                  className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                  title="List view"
                  data-testid="view-list"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                  title="Grid view"
                  data-testid="view-grid"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </div>
              {viewMode === "grid" && <GridSizeControl value={gridSize} onChange={setGridSize} />}
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0 || deleting}
                onClick={handleDelete}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete Selected ({selected.size})
                  </>
                )}
              </Button>
            </div>
          </div>

          {viewMode === "list" ? (
            <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider shrink-0">
                <span className="h-4 w-4 shrink-0" />
                <span className="h-8 w-14 shrink-0" />
                <span className="flex-1 min-w-0">Filename</span>
                <span className="w-20 text-right shrink-0">Resolution</span>
                <span className="w-14 text-right shrink-0">FPS</span>
                <span className="w-16 text-right shrink-0">Duration</span>
                <span className="w-24 text-right shrink-0">Content date</span>
                <span className="w-24 text-right shrink-0">File added</span>
                <span className="w-16 text-right shrink-0">Size</span>
              </div>
              <div className="flex-1 min-h-0">
                <VirtualizedGrid
                  items={sortedResults}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={52}
                  resetKey={`${selectedId}-${sortBy}-${sortDir}`}
                  renderItem={(f) => (
                    <CleanupListRow
                      file={f}
                      selected={selected.has(f.id)}
                      onToggle={() => toggleOne(f.id)}
                      onPlay={() => setPlayingFile(f)}
                    />
                  )}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <VirtualizedGrid
                items={sortedResults}
                getKey={(f) => f.id}
                mode="grid"
                itemHeight={200}
                itemAspectRatio={4 / 3}
                itemChromeHeight={58}
                minColumnWidth={gridSize}
                resetKey={`${selectedId}-${sortBy}-${sortDir}-${gridSize}`}
                renderItem={(f) => (
                  <CleanupCard
                    file={f}
                    isSelected={selected.has(f.id)}
                    onToggle={() => toggleOne(f.id)}
                    onPlay={() => setPlayingFile(f)}
                  />
                )}
              />
            </div>
          )}
        </div>
      )}

      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleTracksUrl={api.subtitleTracksUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
