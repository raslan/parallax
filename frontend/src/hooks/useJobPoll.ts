import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import type { Job } from "@/types/job";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

interface UseJobPollOptions {
  intervalMs?: number;
  onTerminal?: (job: Job) => void;
}

/**
 * Polls one job's status/progress until it reaches a terminal state. Interior
 * is a `useQuery` with a `refetchInterval` that returns `false` once the job is
 * terminal (stopping the poll). Public API is unchanged: `start(id)` after
 * creating a job, `resume(jobs, predicate)` on mount to pick a job back up
 * across a refresh, `onTerminal` fires exactly once per job.
 */
export function useJobPoll(options: UseJobPollOptions = {}) {
  const { intervalMs = 1500 } = options;
  const [jobId, setJobId] = useState<number | null>(null);

  const onTerminalRef = useRef(options.onTerminal);
  useEffect(() => {
    onTerminalRef.current = options.onTerminal;
  });
  const firedTerminalFor = useRef<number | null>(null);

  const { data: job } = useQuery({
    queryKey: qk.job(jobId ?? -1),
    queryFn: () => api.getJob(jobId as number),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.includes(status) ? false : intervalMs;
    },
  });

  // Fire onTerminal once, on the transition into a terminal state.
  useEffect(() => {
    if (!job || jobId == null) return;
    if (TERMINAL_STATUSES.includes(job.status) && firedTerminalFor.current !== jobId) {
      firedTerminalFor.current = jobId;
      onTerminalRef.current?.(job);
    }
  }, [job, jobId]);

  const start = useCallback((id: number) => {
    firedTerminalFor.current = null;
    setJobId(id);
  }, []);

  const stop = useCallback(() => setJobId(null), []);

  /**
   * Picks back up an already-running job matching `predicate` (e.g. by type) so
   * a page refresh doesn't lose a bulk job's progress.
   */
  const resume = useCallback((jobs: Job[], predicate: (job: Job) => boolean) => {
    const active = jobs.find(
      (j) => predicate(j) && (j.status === "running" || j.status === "pending"),
    );
    if (!active) return null;
    firedTerminalFor.current = null;
    setJobId(active.id);
    return active;
  }, []);

  return {
    jobId,
    status: job?.status ?? (jobId != null ? "pending" : null),
    progress: job?.progress ?? 0,
    currentFile: job?.current_file ?? null,
    error: job?.error ?? null,
    start,
    stop,
    resume,
  };
}
