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
  const applyLiveUpdate = (liveJobs: Job[]) => {
    queryClient.setQueryData<Job[]>(qk.jobs(), (prev = []) => {
      const liveMap = new Map(liveJobs.map((j) => [j.id, j]));
      const merged = prev.map((j) => (liveMap.has(j.id) ? { ...j, ...liveMap.get(j.id) } : j));
      for (const lj of liveJobs) {
        if (!merged.find((j) => j.id === lj.id)) merged.unshift(lj);
      }
      return merged;
    });
  };

  useEventSource<Job[]>(
    api.jobsStreamUrl(),
    (live) => {
      applyLiveUpdate(live);
      if (live.length === 0) loadAll();
    },
    () => loadAll(),
  );

  return useMemo(
    () => ({
      activeCount: jobs.filter((j) => ACTIVE.has(j.status)).length,
      aggregateProgress: computeAggregateProgress(jobs),
    }),
    [jobs],
  );
}
