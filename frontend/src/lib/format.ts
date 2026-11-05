/** Placeholder shown by every formatter when a value is missing or invalid. */
const EMPTY_VALUE = "—";

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes) || bytes < 0) return EMPTY_VALUE;
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return EMPTY_VALUE;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBitrate(bps: number | null): string {
  if (!bps) return EMPTY_VALUE;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} kbps`;
  return `${bps} bps`;
}

/** "14 files (8.2 GB)" — a count with its noun pluralised, plus the total size when known. */
export function describeSelection(count: number, noun: string, bytes?: number): string {
  const text = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return bytes != null && bytes > 0 ? `${text} (${formatSize(bytes)})` : text;
}

/**
 * Combined `size` of the items whose id is in `ids`. Pass `key` to match on
 * something other than `id` (e.g. Organize's path-keyed files).
 */
export function sumSizeOf(
  items: readonly { id: number; size: number }[],
  ids: ReadonlySet<number>,
): number;
export function sumSizeOf<T extends { size: number }, K>(
  items: readonly T[],
  ids: ReadonlySet<K>,
  key: (item: T) => K,
): number;
export function sumSizeOf(
  items: readonly { id?: unknown; size: number }[],
  ids: ReadonlySet<unknown>,
  key: (item: { id?: unknown; size: number }) => unknown = (item) => item.id,
): number {
  let total = 0;
  for (const item of items) if (ids.has(key(item))) total += item.size;
  return total;
}

/** Parse a server timestamp; naive ISO strings from the backend are UTC. */
export function parseServerDate(iso: string): Date {
  return new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
];

/** "2 days ago", "just now", "in 3 hours" — coarse, for scanning a list at a glance. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  let delta = (date.getTime() - now.getTime()) / 1000;
  if (Math.abs(delta) < 45) return RELATIVE.format(0, "second");
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) < size) return RELATIVE.format(Math.round(delta), unit);
    delta /= size;
  }
  return RELATIVE.format(Math.round(delta), "year");
}

export function formatUnixDate(ts: number | null): string {
  if (ts === null) return EMPTY_VALUE;
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
