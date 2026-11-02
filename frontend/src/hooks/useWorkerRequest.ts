import { useEffect, useRef, useState } from "react";

/**
 * Request/response plumbing for a module Web Worker, shared by every hook that
 * offloads a pure computation (`useClusterDuplicates`, `useNameGroups`, Audio
 * Duplicates' clustering). `createWorker` runs once on mount (keep the literal
 * `new Worker(new URL("…", import.meta.url), { type: "module" })` in the caller so
 * Vite can bundle it) and the worker is terminated on unmount. Each new `request`
 * identity (memoise it) is posted with an incrementing `requestId`; answers whose
 * id isn't the latest are dropped, so a slow stale run can't clobber a newer one.
 * The previous `response` stays while a new request is `pending`.
 */
export function useWorkerRequest<
  Req extends { requestId: number },
  Res extends { requestId: number },
>(
  createWorker: () => Worker,
  request: Omit<Req, "requestId">,
  { initialPending = true }: { initialPending?: boolean } = {},
) {
  const [response, setResponse] = useState<Res | null>(null);
  const [pending, setPending] = useState(initialPending);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<Res>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale, a newer request is in flight
      setResponse(event.data);
      setPending(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // The worker is created once per mount; a new `createWorker` identity is ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    setPending(true);
    worker.postMessage({ ...request, requestId });
  }, [request]);

  return { response, pending };
}
