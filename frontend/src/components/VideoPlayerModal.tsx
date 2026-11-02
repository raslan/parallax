import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { streamApi } from "@/lib/api";
import { BASE } from "@/lib/api/client";
import type { StreamPrepareStatus } from "@/types/stream";
import type { SubtitleTrack } from "@/types/subtitle";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { ProgressBar } from "@/components/ProgressBar";

// Video.js and its skin CSS load on first open so they stay out of the main bundle.
const VideoJsPlayer = lazy(() => import("./VideoJsPlayer"));
const VideoJsAudioPlayer = lazy(() => import("./VideoJsAudioPlayer"));

interface PlayableFile {
  id: number;
  filename: string;
  path: string;
  size?: number;
  duration?: number | null;
  codec_name?: string | null;
  video_bitrate?: number | null;
}

export function VideoPlayerModal({
  file,
  streamUrl,
  subtitleTracksUrl,
  isAudio,
  prepareFn = streamApi.prepare,
  statusFn = streamApi.status,
  onClose,
}: {
  file: PlayableFile;
  streamUrl: string;
  subtitleTracksUrl?: string;
  isAudio?: boolean;
  /** Start/check the playback prep for a path; defaults to the library stream API. */
  prepareFn?: (path: string) => Promise<StreamPrepareStatus>;
  /** Poll the prep started by `prepareFn`; pass both or neither. */
  statusFn?: (path: string) => Promise<StreamPrepareStatus>;
  onClose: () => void;
}) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [tracksReady, setTracksReady] = useState(false);

  // Some source files carry an audio codec (AC3/DTS/TrueHD 5.1 etc.) the
  // browser can't decode natively — video plays, audio is silent. The backend
  // converts those to a live HLS stream (video copied, audio to AAC) that is
  // playable within seconds; this checks/starts it before the player opens.
  const [prepStatus, setPrepStatus] = useState<"checking" | "ready" | "running" | "error">(
    "checking",
  );
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepError, setPrepError] = useState<string | null>(null);
  const prepPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const stopPrepPoll = () => {
      if (prepPollRef.current) {
        clearInterval(prepPollRef.current);
        prepPollRef.current = null;
      }
    };

    // Initialize prep state at effect start
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrepStatus("checking");
    setPrepProgress(0);
    setPrepError(null);
    setHlsUrl(null);

    // Audio files never get a converted stream; play them as-is.
    if (isAudio) {
      setPrepStatus("ready");
      return;
    }

    const play = (s: StreamPrepareStatus) => {
      setHlsUrl(s.mode === "hls" && s.url ? `${window.location.origin}${BASE}${s.url}` : null);
      setPrepStatus("ready");
    };

    prepareFn(file.path)
      .then((s) => {
        if (cancelled) return;
        if (s.status === "ready") {
          play(s);
          return;
        }
        if (s.status === "error") {
          setPrepStatus("error");
          setPrepError(s.error);
          return;
        }

        setPrepStatus("running");
        setPrepProgress(s.progress);
        prepPollRef.current = setInterval(async () => {
          try {
            const poll = await statusFn(file.path);
            if (cancelled) return;
            setPrepProgress(poll.progress);
            if (poll.status === "ready") {
              stopPrepPoll();
              play(poll);
            } else if (poll.status === "error") {
              stopPrepPoll();
              setPrepStatus("error");
              setPrepError(poll.error);
            }
          } catch {
            /* keep polling — a transient fetch failure isn't fatal */
          }
        }, 1500);
      })
      .catch(() => {
        if (!cancelled) setPrepStatus("ready");
      }); // fail open — don't block playback on a broken check

    return () => {
      cancelled = true;
      stopPrepPoll();
    };
    // The prepare/status fns are stable (module-level) for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, isAudio]);

  // Fetch subtitle tracks before mounting the player so its <track> children
  // are in the DOM from the first render.
  useEffect(() => {
    if (prepStatus !== "ready" && prepStatus !== "error") return;
    if (!subtitleTracksUrl) {
      // Mark tracks ready when no URL available
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTracksReady(true);
      return;
    }
    fetch(subtitleTracksUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then((t: SubtitleTrack[]) => {
        setTracks(t);
        setTracksReady(true);
      })
      .catch(() => setTracksReady(true));
  }, [subtitleTracksUrl, prepStatus]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/85" />
      <div
        className={`relative z-10 w-full px-4 flex flex-col gap-3 max-h-screen py-4 ${isAudio ? "max-w-lg" : "max-w-5xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <p className="text-white text-sm font-medium truncate pr-4" title={file.path}>
            {file.filename}
          </p>
          <button
            onClick={onClose}
            aria-label="Close player"
            className="text-white/70 hover:text-white transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {(prepStatus === "checking" || prepStatus === "running") && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/70" />
              <p className="text-white/80 text-sm max-w-sm">
                This file's audio isn't supported by your browser — converting it for playback…
              </p>
              {prepStatus === "running" && (
                <ProgressBar
                  value={Math.max(2, prepProgress)}
                  label="Converting audio for playback"
                  className="w-48 h-1 bg-white/15"
                  barClassName="bg-white/70"
                />
              )}
            </div>
          )}
          {prepStatus === "error" && (
            <p className="text-white/60 text-xs text-center py-4" title={prepError ?? undefined}>
              Couldn't convert this file's audio — playing original (audio may be silent).
            </p>
          )}
          {(prepStatus === "ready" || prepStatus === "error") && tracksReady && (
            <Suspense
              fallback={
                <div className="flex justify-center py-24">
                  <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                </div>
              }
            >
              {isAudio ? (
                <VideoJsAudioPlayer key={file.id} streamUrl={streamUrl} />
              ) : (
                <VideoJsPlayer
                  key={file.id}
                  streamUrl={streamUrl}
                  hlsUrl={hlsUrl}
                  tracks={tracks}
                />
              )}
            </Suspense>
          )}
        </div>
        <p className="text-white/50 text-xs text-center shrink-0">
          {file.size ? formatSize(file.size) : ""}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {file.codec_name ? ` · ${file.codec_name.toUpperCase()}` : ""}
          {file.video_bitrate ? ` · ${formatBitrate(file.video_bitrate)}` : ""}
          {" · "}
          {file.path}
        </p>
      </div>
    </div>
  );
}
