import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";

interface PlayableFile {
  id: number;
  filename: string;
  path: string;
  size: number;
  duration: number | null;
  codec_name: string | null;
  video_bitrate: number | null;
}

export function VideoPlayerModal({ file, onClose }: { file: PlayableFile; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/80" />
      <div
        className="relative z-10 w-full max-w-5xl px-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
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
        <video
          ref={videoRef}
          src={api.streamUrl(file.id)}
          controls
          autoPlay
          className="w-full rounded-lg bg-black max-h-[80vh]"
        />
        <p className="text-white/50 text-xs text-center">
          {formatSize(file.size)}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {file.codec_name ? ` · ${file.codec_name.toUpperCase()}` : ""}
          {file.video_bitrate ? ` · ${formatBitrate(file.video_bitrate)}` : ""}
          {" · "}{file.path}
        </p>
      </div>
    </div>
  );
}
