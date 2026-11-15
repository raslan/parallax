import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { streamApi, subtitlesApi } from "@/lib/api";
import { useVideoSource } from "@/hooks/useVideoSource";
import type { SeekRequest } from "@/components/PlayerSeek";
import type { SubtitleTrack } from "@/types/subtitle";

const VideoJsPlayer = lazy(() => import("@/components/VideoJsPlayer"));

/**
 * The video with one temporary subtitle track (`extraTracks`, a candidate's preview) or the
 * video's own `tracks`. The Compare player has no other tracks, so only the temporary one's
 * cues show.
 */
export function ComparePlayer({
  path,
  tracks = [],
  extraTracks,
  seekRequest,
  onTime,
}: {
  path: string;
  tracks?: SubtitleTrack[];
  extraTracks?: SubtitleTrack[];
  seekRequest?: SeekRequest;
  onTime?: (seconds: number) => void;
}) {
  const { status, src, hlsUrl } = useVideoSource({
    path,
    streamUrl: subtitlesApi.streamUrl(path),
    prepareFn: streamApi.prepare,
    statusFn: streamApi.status,
  });
  if (status === "checking" || status === "running")
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing the video for playback…
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      <VideoJsPlayer
        streamUrl={src}
        hlsUrl={hlsUrl}
        tracks={tracks}
        extraTracks={extraTracks}
        seekRequest={seekRequest}
        onTime={onTime}
        compact
      />
    </Suspense>
  );
}
