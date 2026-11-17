// The Video.js 10 audio-only player behind VideoPlayerModal (`isAudio`); lazy like VideoJsPlayer.
import "@videojs/react/audio/neutral-skin.css";
import { Audio, AudioPlayer, NeutralAudioSkin } from "@videojs/react/audio";
import { MEDIA_THEME_STYLE, focusPlayer } from "./videoJsShared";
import { VolumePersistence } from "./VolumePersistence";
import { PlayOnLoad } from "./PlayOnLoad";

export default function VideoJsAudioPlayer({ streamUrl }: { streamUrl: string }) {
  return (
    <div ref={focusPlayer}>
      <AudioPlayer>
        <NeutralAudioSkin style={MEDIA_THEME_STYLE}>
          <VolumePersistence />
          <PlayOnLoad />
          <Audio src={streamUrl} preload="metadata" />
        </NeutralAudioSkin>
      </AudioPlayer>
    </div>
  );
}
