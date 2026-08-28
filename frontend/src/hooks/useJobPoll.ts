import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Job } from "@/types/job";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

interface UseJobPollOptions {
  intervalMs?: number;
  onTerminal?: (job: Job) => void;
}

/**
 * Polls a job's status/progress on an interval until it reaches a terminal
 * state, mirroring the pattern previously duplicated across Compress,
 * Toolbox, and Subtitles pages. Call `start(id)` after creating a job, or
 * `resume(jobs, predicate)` on mount to pick back up a job left running
 * across a page refresh.
 */
export function useJobPoll(options: UseJobPollOptions = {}) {
  const { intervalMs = 1500 } = options;
  const [jobId, setJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTerminalRef = useRef(options.onTerminal);
  useEffect(() => {
    onTerminalRef.current = options.onTerminal;
  });

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const applyJob = (job: Job) => {
    setProgress(job.progress ?? 0);
    setCurrentFile(job.current_file ?? null);
    setStatus(job.status);
    setError(job.error ?? null);
  };

  const runPoll = useCallback(
    (id: number) => {
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.getJob(id);
          applyJob(job);
          if (TERMINAL_STATUSES.includes(job.status)) {
            stop();
            onTerminalRef.current?.(job);
          }
        } catch {
          stop();
        }
      }, intervalMs);
    },
    [intervalMs, stop],
  );

  const start = useCallback(
    (id: number) => {
      stop();
      setJobId(id);
      setStatus("pending");
      setProgress(0);
      setCurrentFile(null);
      setError(null);
      runPoll(id);
    },
    [stop, runPoll],
  );

  // Picks back up an already-running job of the given predicate (e.g. by
  // type) so a page refresh doesn't lose a bulk job's progress.
  const resume = useCallback(
    (jobs: Job[], predicate: (job: Job) => boolean) => {
      const active = jobs.find(
        (j) => predicate(j) && (j.status === "running" || j.status === "pending"),
      );
      if (!active) return null;
      stop();
      setJobId(active.id);
      applyJob(active);
      runPoll(active.id);
      return active;
    },
    [stop, runPoll],
  );

  return { jobId, status, progress, currentFile, error, start, stop, resume };
}
