// The Video.js 10 video player behind VideoPlayerModal. Loaded lazily (React.lazy) so the player
// code and its skin CSS stay out of the main bundle until something is first played.
import "@videojs/react/video/neutral-skin.css";
import { NeutralVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { HlsVideo } from "@videojs/react/media/hls-video";
import type { SyntheticEvent } from "react";
import type { SubtitleTrack } from "@/types/subtitle";
import { MEDIA_THEME_STYLE, focusPlayer } from "./videoJsShared";

/** Index of the track to show on load: the browser's language if a track matches, else the first. */
function defaultTrackIndex(tracks: SubtitleTrack[]): number {
  const lang = navigator.language.toLowerCase().split("-")[0];
  const match = tracks.findIndex((t) => t.lang.toLowerCase().split("-")[0] === lang);
  return match >= 0 ? match : 0;
}

/** The converted stream is still growing when it opens, so the engine treats it as live and starts
 *  at the live edge; this puts a first play back at 0:00. Later `canplay` events (after seeks or
 *  rebuffers) are left alone. */
function startAtBeginning(e: SyntheticEvent<HTMLVideoElement>) {
  const video = e.currentTarget;
  if (video.dataset.started) return;
  video.dataset.started = "1";
  if (video.currentTime > 1) video.currentTime = 0;
}

export default function VideoJsPlayer({
  streamUrl,
  hlsUrl,
  tracks,
}: {
  streamUrl: string;
  /** Live HLS playlist for files whose audio the browser can't decode; replaces `streamUrl`. */
  hlsUrl?: string | null;
  tracks: SubtitleTrack[];
}) {
  const shown = defaultTrackIndex(tracks);
  const trackEls = tracks.map((t, i) => (
    <track
      key={t.url}
      kind="subtitles"
      label={t.label}
      srcLang={t.lang}
      src={t.url}
      default={i === shown}
    />
  ));
  return (
    <div ref={focusPlayer}>
      <VideoPlayer>
        <NeutralVideoSkin
          className="bg-black"
          style={{ ...MEDIA_THEME_STYLE, maxHeight: "calc(100vh - 8rem)" }}
        >
          {hlsUrl ? (
            <HlsVideo src={hlsUrl} autoPlay playsInline onCanPlay={startAtBeginning}>
              {trackEls}
            </HlsVideo>
          ) : (
            <Video src={streamUrl} autoPlay playsInline>
              {trackEls}
            </Video>
          )}
        </NeutralVideoSkin>
      </VideoPlayer>
    </div>
  );
}
