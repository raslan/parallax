// Global stubs for the jsdom test environment. Node-env tests ignore this (no window).
if (typeof window !== "undefined") {
  if (!("matchMedia" in window)) {
    // Minimal stub — auto-animate only reads `.matches` for prefers-reduced-motion.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }),
    });
  }
}

if (!("EventSource" in globalThis)) {
  // useJobsFeed opens an SSE stream on mount; tests never assert on it.
  class MockEventSource {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    close() {}
  }
  // @ts-expect-error assigning a minimal stub
  globalThis.EventSource = MockEventSource;
}
