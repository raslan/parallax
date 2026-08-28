import { useEffect, useRef } from "react";

/**
 * Subscribes to a JSON-per-message SSE endpoint. Relies on the browser's
 * built-in EventSource auto-reconnect (same as useLiveFiles) rather than
 * hand-rolling a reconnect timer.
 *
 * onMessage/onError don't need to be memoized — the latest reference is
 * read via a ref on every tick, so passing fresh inline functions is fine.
 */
export function useEventSource<T>(
  url: string | null | undefined,
  onMessage: (data: T) => void,
  onError?: () => void,
): void {
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        onMessageRef.current(JSON.parse(e.data));
      } catch {
        // Ignore malformed SSE messages
      }
    };

    es.onerror = () => onErrorRef.current?.();

    return () => es.close();
  }, [url]);
}
