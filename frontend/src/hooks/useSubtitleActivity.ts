import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk, subtitlesApi } from "@/lib/api";
import type { ActiveJob } from "@/types/subtitle";
import type { Job } from "@/types/job";

const ACTIVE = new Set(["pending", "running"]);
const ACTIVE_POLL_MS = 2000;

/** Whether `path` is `folder` or a folder inside it (both absolute, normalised). */
const within = (path: string, folder: string) =>
  path === folder || path.startsWith(folder === "/" ? "/" : `${folder}/`);

/**
 * Running and waiting subtitle work, by the folder each job was started from
 * (`GET /subtitles/active`). The list is read again whenever a job in the app-wide jobs
 * feed (`qk.jobs()`, kept live by the header's stream) starts, finishes or appears, so a
 * job started from another tab or device shows up; progress and the current file come
 * straight from the feed, so they move without extra requests. `activeFor(folder)` gives
 * the jobs started from that folder or from a folder inside it (a single-file sync stores
 * the video's own folder).
 */
export function useSubtitleActivity() {
  const queryClient = useQueryClient();
  const { data: work = [] } = useQuery({
    queryKey: qk.subtitleActive(),
    queryFn: () => subtitlesApi.active(),
    // Work started elsewhere must show on arrival, not a minute-old snapshot.
    refetchOnMount: "always",
    // While work is listed, ask again every couple of seconds: the jobs feed backs off to one
    // tick per 10 s when idle, so a job that starts and ends inside that gap is never reported
    // as ended and would otherwise sit here as a stale "0%" row until a reload.
    refetchInterval: (q) => (q.state.data && q.state.data.length > 0 ? ACTIVE_POLL_MS : false),
  });
  const { data: jobs } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(),
  });

  // The set of active jobs and their states, as one comparable string.
  const signature = (jobs ?? [])
    .filter((j) => ACTIVE.has(j.status))
    .map((j) => `${j.id}:${j.status}`)
    .join(",");
  const seen = useRef(signature);
  useEffect(() => {
    // Syncs an external fact (the jobs feed changed) into the cache; nothing is set here.
    if (seen.current === signature) return;
    seen.current = signature;
    void queryClient.invalidateQueries({ queryKey: qk.subtitleActive() });
  }, [signature, queryClient]);

  // A job that left the server's active list has ended: refresh the jobs list too, so the
  // header's count and the tab title drop it without waiting for the stream's next tick.
  const workIds = work.flatMap((w) => w.jobs.map((j) => j.id));
  const idsKey = workIds.join(",");
  const knownIds = useRef(new Set<number>());
  useEffect(() => {
    const now = new Set(workIds);
    const ended = [...knownIds.current].some((id) => !now.has(id));
    knownIds.current = now;
    if (ended) void queryClient.invalidateQueries({ queryKey: qk.jobs() });
    // `workIds` is derived from `idsKey`, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, queryClient]);

  const live = useMemo(() => new Map((jobs ?? []).map((j) => [j.id, j])), [jobs]);

  const activeFor = useCallback(
    (folder: string | null): ActiveJob[] => {
      if (folder === null) return [];
      return work
        .filter((w) => within(w.path, folder))
        .flatMap((w) => w.jobs)
        .map((j) => {
          const l = live.get(j.id);
          return l && ACTIVE.has(l.status)
            ? { ...j, status: l.status, progress: l.progress, current_file: l.current_file }
            : j;
        });
    },
    [work, live],
  );

  return { work, activeFor };
}
