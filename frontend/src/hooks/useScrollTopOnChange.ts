import { useEffect, useRef } from "react";

/**
 * Scrolls `scroller` back to the top whenever `signature` changes. For shared-scroll
 * grids, which can't reset themselves: pass a signature that changes only when the
 * result set does (another folder, a changed filter), so re-sorting, refetches and
 * streaming details never make the page jump.
 */
export function useScrollTopOnChange(scroller: Element | null | undefined, signature: string) {
  const last = useRef(signature);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    scroller?.scrollTo({ top: 0 });
  }, [signature, scroller]);
}
