// Remembers the player volume + mute across videos and sessions (Plyr did this out of the box;
// Video.js 10 does not). Render it inside the player skin, shared by the video and audio players.
// Pattern from the Video.js "user preferences" guide.
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@videojs/react";

const STORAGE_KEY = "parallax-player-volume";

interface VolumePrefs {
  volume: number;
  muted: boolean;
}

function readSaved(): VolumePrefs | null {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<VolumePrefs> | null;
    if (!raw || typeof raw.volume !== "number" || !Number.isFinite(raw.volume)) return null;
    return { volume: Math.min(1, Math.max(0, raw.volume)), muted: raw.muted === true };
  } catch {
    return null;
  }
}

function save(prefs: VolumePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private window, blocked site data): skip persistence.
  }
}

// The base `usePlayer` from "@videojs/react" is untyped (the typed one is per-media-type, and this
// component serves both video and audio), so describe just the slice of the store we use.
interface VolumeState {
  volume: number;
  muted: boolean;
}
interface VolumeStore {
  target: unknown;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function VolumePersistence() {
  const store = usePlayer() as unknown as VolumeStore;
  const { volume, muted } = usePlayer((s) => {
    const { volume, muted } = s as unknown as VolumeState;
    return { volume, muted };
  }) as VolumeState;
  // Read once, before the save effect below can overwrite it with the player's default (1.0).
  const [saved] = useState(readSaved);
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current) return;
    save({ volume, muted });
  }, [volume, muted]);

  // Actions throw until the store is attached to the media element, so wait for `target`.
  useEffect(() => {
    const restore = () => {
      if (!store.target) return false;
      if (saved) {
        store.setVolume(saved.volume);
        // setVolume above zero unmutes; re-mute if that was the preference. (The store has no
        // `toggleMuted` in 10.2 — calling it threw and left the controls locked. At volume 0 the
        // player already counts as muted, and `setMuted(false)` there would bump it to 0.25.)
        if (saved.muted && saved.volume > 0) store.setMuted(true);
      }
      restored.current = true;
      return true;
    };
    if (restore()) return;
    const unsubscribe = store.subscribe(() => {
      if (restore()) unsubscribe();
    });
    return unsubscribe;
  }, [store, saved]);

  return null;
}
