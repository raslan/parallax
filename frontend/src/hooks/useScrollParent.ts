import { useCallback, useState } from "react";

/** Nearest ancestor that scrolls vertically, else the document's own scroller. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Callback ref that resolves the element's nearest scrolling ancestor, so children
 * can virtualise against the page's own scroll instead of each owning a scroller.
 * Returns `[scroller, ref]`; `scroller` is null until the ref has attached.
 */
export function useScrollParent() {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    setScroller(el ? findScrollParent(el) : null);
  }, []);
  return [scroller, ref] as const;
}
