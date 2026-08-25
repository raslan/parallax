import { useEffect, useRef, useState } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { Loader2, X } from "lucide-react";
import { streamApi } from "@/lib/api";
import type { SubtitleTrack } from "@/types/subtitle";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";

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
  onClose,
}: {
  file: PlayableFile;
  streamUrl: string;
  subtitleTracksUrl?: string;
  isAudio?: boolean;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [tracksReady, setTracksReady] = useState(false);

  // Some source files carry an audio codec (AC3/DTS/TrueHD 5.1 etc.) the
  // browser can't decode natively — video plays, audio is silent. The backend
  // remuxes those to AAC on demand and caches the result; this checks/starts
  // that before the player opens so playback never silently hangs mid-remux.
  const [prepStatus, setPrepStatus] = useState<"checking" | "ready" | "running" | "error">(
    "checking",
  );
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

    streamApi
      .prepare(file.path)
      .then((s) => {
        if (cancelled) return;
        if (s.status === "ready") {
          setPrepStatus("ready");
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
            const poll = await streamApi.status(file.path);
            if (cancelled) return;
            setPrepProgress(poll.progress);
            if (poll.status === "ready") {
              stopPrepPoll();
              setPrepStatus("ready");
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
  }, [file.path]);

  // Fetch subtitle tracks before initialising Plyr so <track> elements
  // are in the DOM when Plyr scans them.
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

  useEffect(() => {
    if (!tracksReady || !videoRef.current) return;
    const hasTracks = tracks.length > 0;
    const baseControls = [
      "play-large",
      "play",
      "progress",
      "current-time",
      "duration",
      "mute",
      "volume",
    ];
    const controls = isAudio
      ? [...baseControls, "settings"]
      : hasTracks
        ? [...baseControls, "captions", "settings", "fullscreen"]
        : [...baseControls, "fullscreen"];
    playerRef.current = new Plyr(videoRef.current as HTMLVideoElement, {
      controls,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      captions: { active: true, language: "auto" },
      settings: ["captions", "speed"],
    });
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [file.id, tracksReady, tracks.length]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/85" />
      <div
        className={`relative z-10 w-full px-4 flex flex-col gap-3 max-h-screen py-4 ${isAudio ? "max-w-lg" : "max-w-5xl"}`}
        onClick={(e) => e.stopPropagation()}
        style={{ "--plyr-color-main": "hsl(var(--primary))" } as React.CSSProperties}
      >
        <div className="flex items-center justify-between shrink-0">
          <p className="text-white text-sm font-medium truncate pr-4" title={file.path}>
            {file.filename}
          </p>
          <button
            onClick={onClose}
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
                <div className="w-48 h-1 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full bg-white/70 transition-all"
                    style={{ width: `${Math.max(2, prepProgress)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {prepStatus === "error" && (
            <p className="text-white/60 text-xs text-center py-4" title={prepError ?? undefined}>
              Couldn't convert this file's audio — playing original (audio may be silent).
            </p>
          )}
          {(prepStatus === "ready" || prepStatus === "error") &&
            tracksReady &&
            (isAudio ? (
              <audio
                ref={videoRef as React.RefObject<HTMLAudioElement>}
                src={streamUrl}
                autoPlay
                className="w-full"
              />
            ) : (
              <video
                ref={videoRef as React.RefObject<HTMLVideoElement>}
                src={streamUrl}
                autoPlay
                className="w-full h-full rounded-lg"
                style={{ maxHeight: "calc(100vh - 8rem)" }}
              >
                {tracks.map((t) => (
                  <track
                    key={t.url}
                    kind="subtitles"
                    label={t.label}
                    srcLang={t.lang}
                    src={t.url}
                  />
                ))}
              </video>
            ))}
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
