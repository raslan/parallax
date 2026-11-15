// Reports the player's current time. Render it inside the player skin, like PlayerSeek.
import { useEffect } from "react";
import { usePlayer } from "@videojs/react";

export function PlayerTime({ onTime }: { onTime: (seconds: number) => void }) {
  // The base `usePlayer` is untyped; describe the slice used.
  const time = usePlayer((s) => (s as unknown as { currentTime: number }).currentTime) as number;
  useEffect(() => {
    onTime(time);
  }, [time, onTime]);
  return null;
}
