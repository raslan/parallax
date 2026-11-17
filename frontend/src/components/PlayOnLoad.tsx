// Starts playback of the player's own media element once it is attached. Used instead of the
// `autoPlay` attribute: React can build a <video src autoPlay> for a render it then throws away
// (and builds again), and that unseen copy starts playing on its own, so one click gave two
// overlapping soundtracks that no control could reach. A play() on the attached element cannot
// be doubled. Render it inside the player skin, shared by the video and audio players.
import { useEffect } from "react";
import { usePlayer } from "@videojs/react";

// The base `usePlayer` is untyped (the typed one is per media type, and this serves both), so
// describe just the slice of the store used here.
interface PlayStore {
  target: unknown;
  play(): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

export function PlayOnLoad() {
  const store = usePlayer() as unknown as PlayStore;
  useEffect(() => {
    // Actions throw until the store is attached to the media element, so wait for `target`.
    const start = () => {
      if (!store.target) return false;
      // A refusal (the browser's autoplay rules) leaves the video paused for the user to start.
      void Promise.resolve(store.play()).catch(() => undefined);
      return true;
    };
    if (start()) return;
    const unsubscribe = store.subscribe(() => {
      if (start()) unsubscribe();
    });
    return unsubscribe;
  }, [store]);
  return null;
}
