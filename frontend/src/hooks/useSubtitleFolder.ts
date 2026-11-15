import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk, subtitlesApi } from "@/lib/api";
import { folderSearch, normalizeFolderPath } from "@/lib/organizeNav";
import { lengthKey } from "@/lib/subtitleCoverage";
import { groupFiles } from "@/lib/subtitleGroups";
import { useStreamedByFile } from "@/hooks/useStreamedByFile";
import type { ActiveJob, LengthInfo, ScanFile, TitleGroup } from "@/types/subtitle";

/** Stable identities while nothing has loaded, so the memos and the lengths stream hold still. */
const NO_FILES: ScanFile[] = [];
const NO_GROUPS: TitleGroup[] = [];

/** The location search that opens `folder`, and inside it the title `title` when given. */
function subtitlesSearch(folder: string, title?: string | null): string {
  const base = folderSearch(folder, "");
  return title ? `${base}&title=${encodeURIComponent(title)}` : base;
}

/**
 * The folder the Subtitles page shows, and what is on disk in it. The folder lives in the
 * URL (`/subtitles?path=<absolute folder>`, normalised like Organize's; `&title=<key>` when
 * a title is open), so Back/Forward and a reload return to it and nothing is remembered
 * anywhere else. Reads: the scan (every video with its subtitle files), the suggested
 * title groups, the subtitle files no video claims, and the length check, streamed in the
 * background (25 videos a request, 2 in flight, cached per video until its subtitle files
 * change). When a subtitle job started from this folder ends, the folder is read again so
 * the page shows what the job wrote.
 */
export function useSubtitleFolder(activeFor: (folder: string | null) => ActiveJob[]) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raw = params.get("path");
  const folder = raw === null ? null : normalizeFolderPath(raw);
  const badPath = raw !== null && folder === null;
  const titleKey = folder ? params.get("title") : null;
  const folderJobs = activeFor(folder);

  const scanQ = useQuery({
    queryKey: qk.subtitleScan(folder ?? ""),
    queryFn: () => subtitlesApi.scan(folder ?? ""),
    enabled: folder !== null,
    retry: false,
  });
  const groupsQ = useQuery({
    queryKey: qk.subtitleGroups(folder ?? ""),
    queryFn: () => subtitlesApi.groups(folder ?? ""),
    enabled: folder !== null && scanQ.isSuccess,
    retry: false,
  });
  const unmatchedQ = useQuery({
    queryKey: qk.subtitleUnmatched(folder ?? ""),
    queryFn: () => subtitlesApi.unmatched(folder ?? ""),
    enabled: folder !== null && scanQ.isSuccess,
    retry: false,
  });

  const files = scanQ.data ?? NO_FILES;
  const titles = useMemo(() => groupFiles(files, groupsQ.data ?? NO_GROUPS), [files, groupsQ.data]);
  const keyed = useMemo(() => files.map(lengthKey), [files]);
  const lengths = useStreamedByFile<LengthInfo>({
    resetKey: folder ?? "",
    files: keyed,
    enabled: scanQ.isSuccess,
    fetchBatch: subtitlesApi.checkLengths,
  });

  const rescan = () => {
    if (folder === null) return;
    for (const queryKey of [
      qk.subtitleScan(folder),
      qk.subtitleGroups(folder),
      qk.subtitleUnmatched(folder),
    ])
      void qc.invalidateQueries({ queryKey });
  };

  // A job that was running for this folder and is gone has finished: read the disk again.
  const ids = folderJobs.map((j) => j.id).join(",");
  const lastIds = useRef(ids);
  useEffect(() => {
    const before = lastIds.current.split(",").filter(Boolean);
    lastIds.current = ids;
    const now = new Set(ids.split(","));
    if (folder !== null && before.some((id) => !now.has(id))) {
      for (const queryKey of [qk.subtitleScan(folder), qk.subtitleUnmatched(folder)])
        void qc.invalidateQueries({ queryKey });
    }
  }, [ids, folder, qc]);

  /** Opens a folder (a pushed history entry, so Back returns). */
  const openFolder = (path: string) => {
    const p = normalizeFolderPath(path.trim());
    if (p !== null) void navigate({ search: subtitlesSearch(p) });
  };
  /** Opens a title of the open folder, or the folder itself with `null`. */
  const openTitle = (key: string | null) => {
    if (folder !== null) void navigate({ search: subtitlesSearch(folder, key) });
  };

  return {
    folder,
    folderJobs,
    badPath,
    titleKey,
    scanQ,
    groupsQ,
    unmatchedQ,
    files,
    titles,
    lengths,
    rescan,
    openFolder,
    openTitle,
  };
}
