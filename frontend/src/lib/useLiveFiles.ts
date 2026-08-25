import { useEffect, useRef } from "react";
import { api, imageApi } from "@/lib/api";

/**
 * Subscribes to the backend's file-change SSE stream for one library (or,
 * when libraryId is null/undefined, every library of that kind) and calls
 * onChange whenever the signature changes — i.e. whenever a file was
 * inserted, deleted, or had any tracked field updated by ANY code path
 * (scan, Compress, Toolbox, restore, delete, quarantine, the filesystem
 * watcher). Does not call onChange for the initial connection snapshot —
 * only for changes seen after that baseline.
 *
 * onChange does not need to be memoized — the latest reference is read via
 * a ref on every tick, so passing a fresh inline arrow each render is fine.
 */
export function useLiveFiles(
  kind: "video" | "image",
  libraryId: number | null | undefined,
  onChange: () => void,
): void {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const url = kind === "video" ? api.filesStreamUrl(libraryId) : imageApi.streamUrl(libraryId);
    const es = new EventSource(url);
    let lastSignature: string | null = null;
    let lastErrorRefetch = 0;

    es.onmessage = (e) => {
      const isFirst = lastSignature === null;
      if (e.data !== lastSignature) {
        lastSignature = e.data;
        if (!isFirst) onChangeRef.current();
      }
    };

    es.onerror = () => {
      // Connection dropped — the browser auto-reconnects EventSource, retrying
      // roughly every 3s while down, firing onerror on every failed attempt.
      // Debounce so we do one correctness refresh per disconnect, not one
      // per retry attempt.
      const now = Date.now();
      if (now - lastErrorRefetch > 5000) {
        lastErrorRefetch = now;
        onChangeRef.current();
      }
    };

    return () => es.close();
  }, [kind, libraryId]);
}
