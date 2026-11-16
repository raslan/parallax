// Seeks the player when `request.nonce` changes (the same time can be requested twice). Render it
// inside the player skin, like VolumePersistence.
import { useEffect } from "react";
import { usePlayer } from "@videojs/react";

export interface SeekRequest {
  time: number;
  nonce: number;
}

// The base `usePlayer` is untyped; describe the slice used. `seek` waits for the media metadata.
interface SeekStore {
  seek(time: number): Promise<number>;
}

export function PlayerSeek({ request }: { request?: SeekRequest }) {
  const store = usePlayer() as unknown as SeekStore;
  const nonce = request?.nonce;
  const time = request?.time;
  useEffect(() => {
    if (nonce === undefined || time === undefined) return;
    store.seek(time).catch(() => {});
    // Only a new request (nonce) seeks, not a store identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return null;
}
