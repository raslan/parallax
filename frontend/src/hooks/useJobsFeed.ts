import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { useEventSource } from "@/hooks/useEventSource";
import type { Job } from "@/types/job";

const ACTIVE = new Set(["running", "pending"]);

/** @public */
export function computeAggregateProgress(jobs: Job[]): number | "pending" | null {
  const running = jobs.filter((j) => j.status === "running");
  if (running.length === 0) {
    return jobs.some((j) => j.status === "pending") ? "pending" : null;
  }
  let num = 0;
  let den = 0;
  for (const j of running) {
    if (j.total_files > 0) {
      num += j.processed_files;
      den += j.total_files;
    } else {
      num += j.progress;
      den += 100;
    }
  }
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

/** @public */
export function useJobsFeed(): {
  activeCount: number;
  aggregateProgress: number | "pending" | null;
} {
  const queryClient = useQueryClient();

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(),
  });

  const loadAll = () => queryClient.invalidateQueries({ queryKey: qk.jobs() });

  // Merge live SSE updates into the cached list without dropping history entries.
  // A job that was active on the previous tick but is absent from this one just
  // settled (completed/failed/cancelled) — refetch so its real final state lands
  // in the cache instead of the last live snapshot (which can be a "0/0" row from
  // right after the job started). Gating this refetch on the *entire* active list
  // being empty missed settlements whenever a sibling job was still running —
  // common now that jobs serialize behind `max_concurrent_jobs`, leaving a
  // completed job stuck showing its stale snapshot until a manual reload.
  const applyLiveUpdate = (liveJobs: Job[]) => {
    const liveMap = new Map(liveJobs.map((j) => [j.id, j]));
    let settled = false;
    queryClient.setQueryData<Job[]>(qk.jobs(), (prev = []) => {
      settled = prev.some((j) => ACTIVE.has(j.status) && !liveMap.has(j.id));
      const merged = prev.map((j) => (liveMap.has(j.id) ? { ...j, ...liveMap.get(j.id) } : j));
      for (const lj of liveJobs) {
        if (!merged.find((j) => j.id === lj.id)) merged.unshift(lj);
      }
      return merged;
    });
    if (settled) loadAll();
  };

  useEventSource<Job[]>(api.jobsStreamUrl(), applyLiveUpdate, () => loadAll());

  return useMemo(
    () => ({
      activeCount: jobs.filter((j) => ACTIVE.has(j.status)).length,
      aggregateProgress: computeAggregateProgress(jobs),
    }),
    [jobs],
  );
}
