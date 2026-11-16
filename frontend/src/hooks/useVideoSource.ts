import { useEffect, useRef, useState } from "react";
import { BASE } from "@/lib/api/client";
import type { StreamPrepareStatus } from "@/types/stream";

const MAX_POLL_FAILURES = 5;

export type VideoSourceStatus = "checking" | "running" | "ready" | "error";

/**
 * Starts/polls the playback preparation for a file (direct play, or an on-demand HLS stream for
 * audio the browser can't decode). Shared by the player modal and the Subtitles compare sheet.
 * `prepareFn`/`statusFn` must be stable (module-level) for every caller. `skip` marks the source
 * ready at once (audio files never get a converted stream).
 */
export function useVideoSource({
  path,
  streamUrl,
  prepareFn,
  statusFn,
  skip = false,
}: {
  path: string;
  streamUrl: string;
  prepareFn: (path: string) => Promise<StreamPrepareStatus>;
  statusFn: (path: string) => Promise<StreamPrepareStatus>;
  skip?: boolean;
}) {
  const [status, setStatus] = useState<VideoSourceStatus>("checking");
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    // Initialize prep state at effect start
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("checking");
    setProgress(0);
    setError(null);
    setHlsUrl(null);

    if (skip) {
      setStatus("ready");
      return;
    }

    const play = (s: StreamPrepareStatus) => {
      setHlsUrl(s.mode === "hls" && s.url ? `${window.location.origin}${BASE}${s.url}` : null);
      setStatus("ready");
    };

    prepareFn(path)
      .then((s) => {
        if (cancelled) return;
        if (s.status === "ready") {
          play(s);
          return;
        }
        if (s.status === "error") {
          setStatus("error");
          setError(s.error);
          return;
        }

        setStatus("running");
        setProgress(s.progress);
        let failures = 0;
        pollRef.current = setInterval(async () => {
          try {
            const poll = await statusFn(path);
            if (cancelled) return;
            failures = 0;
            setProgress(poll.progress);
            if (poll.status === "ready") {
              stopPoll();
              play(poll);
            } else if (poll.status === "error") {
              stopPoll();
              setStatus("error");
              setError(poll.error);
            }
          } catch (e) {
            if (cancelled) return;
            // A transient failure is retried; a steady one must not poll forever.
            failures += 1;
            if (failures >= MAX_POLL_FAILURES) {
              stopPoll();
              setStatus("error");
              setError(e instanceof Error ? e.message : "Could not check the stream");
            }
          }
        }, 1500);
      })
      .catch(() => {
        if (!cancelled) setStatus("ready");
      }); // fail open: don't block playback on a broken check

    return () => {
      cancelled = true;
      stopPoll();
    };
    // The prepare/status fns are stable (module-level) for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, skip]);

  return { status, src: hlsUrl ?? streamUrl, hlsUrl, progress, error };
}
