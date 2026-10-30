import { useState, useEffect, useMemo } from "react";
import { Scissors, Loader2, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/Skeletons";
import { EmptyState, NoLibrariesState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { SelectionBar } from "@/components/SelectionBar";
import { audioFilesApi, audioLibrariesApi, qk } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { FileListRow } from "@/components/FileSelectGrid";
import {
  formatSize,
  formatDuration,
  formatUnixDate,
  describeSelection,
  sumSizeOf,
} from "@/lib/format";
import { QueryBuilder } from "@/components/QueryBuilder";
import { LibraryBar } from "@/components/LibraryBar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryBuilder } from "@/hooks/useQueryBuilder";
import { audioCleanupFields } from "@/lib/audioCleanupFields";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { useConfirm } from "@/components/ConfirmProvider";

function CleanupColumns({ file }: { file: AudioFile }) {
  return (
    <>
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
    </>
  );
}

export function AudioCleanup() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate } =
    useQueryBuilder(audioCleanupFields);

  const {
    selected,
    setSelected,
    toggle: toggleOne,
    selectAll: selectAllIds,
    setOrder,
    marqueeProps,
  } = useSelection();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingFile, setPlayingFile] = useState<AudioFile | null>(null);
  const {
    sortKey: sortBy,
    setSortKey: setSortBy,
    sortDir,
    setSortDir,
  } = useSort<string>("filename");

  const { data: libraries = [] } = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
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
    refetch: refetchFiles,
  } = useQuery({
    queryKey: qk.audioFiles(selectedId ?? -1),
    queryFn: () => audioFilesApi.list(selectedId as number),
    enabled: selectedId != null,
  });
  const allFiles = selectedId == null ? null : (allFilesData ?? null);
  const displayError = error ?? (fetchError ? getErrorMessage(fetchError) : null);

  useLiveFiles("audio", selectedId, () => {
    if (selectedId != null) {
      queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
    }
  });

  const SORT_OPTIONS = [
    { value: "filename", label: "Name" },
    { value: "size", label: "Size" },
    { value: "duration", label: "Duration" },
    { value: "bitrate", label: "Bitrate" },
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
      const av = (a[sortBy as keyof AudioFile] ?? "") as unknown;
      const bv = (b[sortBy as keyof AudioFile] ?? "") as unknown;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filteredResults, sortBy, sortDir]);
  const orderedIds = useMemo(() => (sortedResults ?? []).map((f) => f.id), [sortedResults]);
  useSelectionOrder(setOrder, orderedIds);

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
    if (
      !(await confirm({
        title: "Move to originals?",
        description: `Move ${describeSelection(selected.size, "file", sumSizeOf(allFiles, selected))} to _originals/ and remove from library?`,
        confirmText: "Move",
        destructive: true,
      }))
    )
      return;
    setDeleting(true);
    setError(null);
    try {
      await audioFilesApi.deleteFiles([...selected]);
      queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
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
          <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stack filters to find files matching all conditions, then bulk-delete matches.
          </p>
        </div>
      </div>

      {libraries.length > 0 && (
        <LibraryBar
          libraries={libraries}
          libraryId={selectedId}
          onLibraryChange={(id) => {
            setSelectedId(id);
            setSelected(new Set());
            setError(null);
          }}
        />
      )}

      <div className="rounded-lg border bg-card p-4 shrink-0">
        <QueryBuilder
          registry={audioCleanupFields}
          clauses={clauses}
          fieldsByKey={fieldsByKey}
          onAdd={addClause}
          onRemove={removeClause}
          onUpdate={updateClause}
        />
      </div>

      {fetchError ? (
        <QueryError error={fetchError} onRetry={() => void refetchFiles()} />
      ) : (
        error && <p className="text-sm text-destructive">{error}</p>
      )}

      {loading && <ListSkeleton />}

      {!loading && libraries.length === 0 && <NoLibrariesState kind="audio" />}

      {!loading && libraries.length > 0 && allFiles === null && !displayError && (
        <EmptyState
          icon={Scissors}
          title="Ready to search"
          description="Add a filter above to narrow these files down. All active filters stack — results must match every condition."
        />
      )}

      {!loading && sortedResults !== null && sortedResults.length === 0 && (
        <EmptyState
          icon={Scissors}
          title="No files match"
          description="Try adjusting the filters."
        />
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
                <Checkbox
                  checked={selected.size === sortedResults.length && sortedResults.length > 0}
                  onCheckedChange={() => toggleAll()}
                />
                Select all
              </label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-36">
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
          <SelectionBar
            count={selected.size}
            bytes={allFiles ? sumSizeOf(allFiles, selected) : undefined}
            onClear={() => setSelected(new Set())}
          >
            <Button variant="destructive" size="sm" disabled={deleting} onClick={handleDelete}>
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </SelectionBar>

          <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider shrink-0">
              <span className="w-4 shrink-0" />
              <span className="w-14 shrink-0" />
              <span className="flex-1 min-w-0">Filename</span>
              <span className="w-16 text-right shrink-0">Duration</span>
              <span className="w-24 text-right shrink-0">Content date</span>
              <span className="w-24 text-right shrink-0">File added</span>
              <span className="w-16 text-right shrink-0">Size</span>
            </div>
            <div className="flex-1 min-h-0">
              <VirtualizedGrid
                {...marqueeProps}
                items={sortedResults}
                getKey={(f) => f.id}
                mode="list"
                itemHeight={50}
                resetKey={`${selectedId}-${sortBy}-${sortDir}`}
                renderItem={(f) => (
                  <FileListRow
                    file={f}
                    clickAction="select"
                    selected={selected.has(f.id)}
                    onToggle={() => toggleOne(f.id)}
                    onPlay={() => setPlayingFile(f)}
                    columns={<CleanupColumns file={f} />}
                  />
                )}
              />
            </div>
          </div>
        </div>
      )}

      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={audioFilesApi.streamUrl(playingFile.id)}
          isAudio
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
