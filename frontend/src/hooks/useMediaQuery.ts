import { useSyncExternalStore } from "react";

/** Live `window.matchMedia(query).matches`; false when matchMedia is unavailable (SSR, tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia?.(query).matches) || false,
    () => false,
  );
}
