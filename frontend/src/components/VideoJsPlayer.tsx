// The Video.js 10 video player behind VideoPlayerModal. Loaded lazily (React.lazy) so the player
// code and its skin CSS stay out of the main bundle until something is first played.
import { useCallback, useRef } from "react";
import "@videojs/react/video/neutral-skin.css";
import { NeutralVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { HlsVideo } from "@videojs/react/media/hls-video";
import type { SubtitleTrack } from "@/types/subtitle";
import { MEDIA_THEME_STYLE, focusPlayer } from "./videoJsShared";
import { VolumePersistence } from "./VolumePersistence";
import { cn } from "@/lib/utils";
import { PlayerSeek, type SeekRequest } from "./PlayerSeek";
import { PlayerTime } from "./PlayerTime";

/** Index of the track to show on load: the browser's language if a track matches, else the first. */
function defaultTrackIndex(tracks: SubtitleTrack[]): number {
  const lang = navigator.language.toLowerCase().split("-")[0];
  const match = tracks.findIndex((t) => t.lang.toLowerCase().split("-")[0] === lang);
  return match >= 0 ? match : 0;
}

export default function VideoJsPlayer({
  streamUrl,
  hlsUrl,
  tracks,
  extraTracks,
  seekRequest,
  onTime,
  compact,
}: {
  streamUrl: string;
  /** Live HLS playlist for files whose audio the browser can't decode; replaces `streamUrl`. */
  hlsUrl?: string | null;
  tracks: SubtitleTrack[];
  /** Temporary tracks (e.g. a candidate preview) listed after `tracks`; when present the first
   * one is shown. */
  extraTracks?: SubtitleTrack[];
  /** Seek to `time` whenever `nonce` changes. */
  seekRequest?: SeekRequest;
  /** Called with the current playback time (seconds) as it changes. */
  onTime?: (seconds: number) => void;
  /** For a small panel: the video is capped at a third of the screen instead of nearly all of it. */
  compact?: boolean;
}) {
  const all = extraTracks?.length ? [...tracks, ...extraTracks] : tracks;
  const shown = extraTracks?.length ? tracks.length : defaultTrackIndex(tracks);
  const trackEls = all.map((t, i) => (
    <track
      key={t.url}
      kind="subtitles"
      label={t.label}
      srcLang={t.lang}
      src={t.url}
      default={i === shown}
    />
  ));
  // A removed <video> keeps playing its audio while the browser still references it (an HLS
  // engine does), so skipping between rows layered one video's sound on the last one's.
  // Stop and release the media element when the wrapper leaves the page.
  const wrapper = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      wrapper.current = el;
      focusPlayer(el);
      return;
    }
    const gone = wrapper.current;
    wrapper.current = null;
    gone?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => {
      m.pause();
      m.removeAttribute("src");
      m.load();
    });
  }, []);
  return (
    <div ref={attach}>
      <VideoPlayer>
        {/* The skin's <video> is width/height 100% of an auto-height box, so a tall video gets a
            box taller than the screen. Cap the video itself (not the skin, which would clip it)
            and object-fit: contain letterboxes it inside. */}
        <NeutralVideoSkin
          className={cn(
            "bg-black",
            compact ? "[&_video]:max-h-[35dvh]" : "[&_video]:max-h-[calc(100vh-8rem)]",
          )}
          style={MEDIA_THEME_STYLE}
        >
          <VolumePersistence />
          <PlayerSeek request={seekRequest} />
          {onTime && <PlayerTime onTime={onTime} />}
          {hlsUrl ? (
            <HlsVideo src={hlsUrl} autoPlay playsInline>
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
