const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Locale-aware natural compare: "clip2" < "clip10", case-insensitive. */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);
