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

    es.onmessage = (e) => {
      const isFirst = lastSignature === null;
      if (e.data !== lastSignature) {
        lastSignature = e.data;
        if (!isFirst) onChangeRef.current();
      }
    };

    // No onerror handler: the browser auto-reconnects EventSource on its own,
    // reusing this same `es` object — so `lastSignature` survives the drop,
    // and the reconnected stream's first message goes through the same
    // comparison above. A dropped connection alone is not a data change;
    // firing onChange from onerror would report every network blip (or, on
    // Cleanup/Duplicates, show a false "results may be out of date" banner)
    // as if a file had actually changed, whether or not one had.

    return () => es.close();
  }, [kind, libraryId]);
}
