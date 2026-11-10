import { useCallback, useMemo } from "react";
import { organizeFields } from "@/lib/organizeSearch";
import { sortFiles, type FileSortKey } from "@/lib/organizeSort";
import type { SortDir } from "@/components/FileSelectGrid";
import { useQueryBuilder } from "@/hooks/useQueryBuilder";
import type { FileDetails, OrganizeFile, OrganizeTagInfo } from "@/types/organize";

/** Filter fields that need ffprobe details, which stream in after the list. */
const ENRICHED = new Set(["duration", "resolution", "orientation", "codec", "bitrate"]);

/**
 * The filtered and sorted view of the open folder's files: the query builder over
 * `organizeFields`, the rows it keeps (rows carry their streamed details so enriched
 * fields can test them), the order they are shown in, and how many details are still
 * loading while an enriched or tag clause waits on them. `tagsProgress` (the streamed
 * embedded tags) is optional: tag clauses are false for a file until its tags arrive,
 * and `tagsWanted` says whether a tag clause needs them fetched at all.
 */
export function useOrganizeFilters(
  fileList: OrganizeFile[],
  detailsProgress: {
    details: Record<string, FileDetails | null>;
    loaded: number;
    total: number;
  },
  sort: { sortKey: FileSortKey; sortDir: SortDir },
  tagsProgress?: {
    tags: Record<string, OrganizeTagInfo | null>;
    loaded: number;
    total: number;
  },
) {
  const { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate } =
    useQueryBuilder(organizeFields);
  const { details } = detailsProgress;
  const tags = tagsProgress?.tags;
  const visibleFiles = useMemo(() => {
    if (clauses.length === 0) return fileList;
    return fileList.filter((f) =>
      evaluate({ ...f, details: details[f.path], tags: tags?.[f.path] }),
    );
  }, [clauses.length, fileList, details, tags, evaluate]);
  // Sorting never changes membership; shift-range selection follows this order.
  const sortedFiles = useMemo(
    () => sortFiles(visibleFiles, details, sort.sortKey, sort.sortDir, tags),
    [visibleFiles, details, sort.sortKey, sort.sortDir, tags],
  );
  const visiblePaths = useMemo(() => sortedFiles.map((f) => f.path), [sortedFiles]);

  // Computed once per list of files (NameGroupChips defers and memoises on this identity).
  const fileNames = useMemo(() => fileList.map((f) => f.name), [fileList]);

  const enrichedActive = clauses.some((c) => ENRICHED.has(c.fieldKey));
  const tagsWanted = clauses.some((c) => c.fieldKey.startsWith("tag_"));
  const detailsPending = enrichedActive
    ? Math.max(0, detailsProgress.total - detailsProgress.loaded)
    : 0;
  const tagsPending =
    tagsWanted && tagsProgress ? Math.max(0, tagsProgress.total - tagsProgress.loaded) : 0;
  const stillLoading = Math.max(detailsPending, tagsPending);

  const pickName = useCallback(
    (text: string) => {
      const dup = clauses.some(
        (c) =>
          c.fieldKey === "name" &&
          c.operator === "contains" &&
          (c.value as { text?: string } | null)?.text === text,
      );
      if (dup) return;
      const id = addClause("name");
      if (id) updateClause(id, { value: { text } });
    },
    [clauses, addClause, updateClause],
  );

  return {
    clauses,
    fieldsByKey,
    addClause,
    removeClause,
    updateClause,
    visibleFiles,
    sortedFiles,
    visiblePaths,
    fileNames,
    stillLoading,
    tagsWanted,
    pickName,
  };
}
