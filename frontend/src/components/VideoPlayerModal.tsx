import { useEffect, useRef, useState } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { X } from "lucide-react";
import { SubtitleTrack } from "@/lib/api";
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
  onClose,
}: {
  file: PlayableFile;
  streamUrl: string;
  subtitleTracksUrl?: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [tracksReady, setTracksReady] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch subtitle tracks before initialising Plyr so <track> elements
  // are in the DOM when Plyr scans them.
  useEffect(() => {
    if (!subtitleTracksUrl) {
      setTracksReady(true);
      return;
    }
    fetch(subtitleTracksUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then((t: SubtitleTrack[]) => { setTracks(t); setTracksReady(true); })
      .catch(() => setTracksReady(true));
  }, [subtitleTracksUrl]);

  useEffect(() => {
    if (!tracksReady || !videoRef.current) return;
    const hasTracks = tracks.length > 0;
    const baseControls = ["play-large", "play", "progress", "current-time", "duration", "mute", "volume"];
    const controls = hasTracks
      ? [...baseControls, "captions", "fullscreen"]
      : [...baseControls, "fullscreen"];
    playerRef.current = new Plyr(videoRef.current, {
      controls,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      captions: { active: true, language: "auto" },
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
        className="relative z-10 w-full max-w-5xl px-4 flex flex-col gap-3 max-h-screen py-4"
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
          {tracksReady && (
            <video
              ref={videoRef}
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
          )}
        </div>
        <p className="text-white/50 text-xs text-center shrink-0">
          {file.size ? formatSize(file.size) : ""}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {file.codec_name ? ` · ${file.codec_name.toUpperCase()}` : ""}
          {file.video_bitrate ? ` · ${formatBitrate(file.video_bitrate)}` : ""}
          {" · "}{file.path}
        </p>
      </div>
    </div>
  );
}
