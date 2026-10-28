import type { StatsBucket, StatsPoint } from "@/types/stats";
import { formatSize } from "@/lib/format";

/** Time windows offered on the Home page. `days: 0` means all time. */
export const RANGES = [
  { key: "7", label: "7 days", days: 7, bucket: "day" },
  { key: "30", label: "30 days", days: 30, bucket: "day" },
  { key: "90", label: "90 days", days: 90, bucket: "week" },
  { key: "365", label: "1 year", days: 365, bucket: "month" },
  { key: "all", label: "All time", days: 0, bucket: "month" },
] as const satisfies readonly { key: string; label: string; days: number; bucket: StatsBucket }[];

export type RangeKey = (typeof RANGES)[number]["key"];

export const DEFAULT_RANGE: RangeKey = "30";

export function isRangeKey(v: unknown): v is RangeKey {
  return RANGES.some((r) => r.key === v);
}

export function rangeOf(key: RangeKey) {
  return RANGES.find((r) => r.key === key) ?? RANGES[1];
}

/** Percentage change from `previous` to `current`; null when there is no baseline. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Running total of `bytes_saved`, never below 0, for a "space saved so far" curve. */
export function cumulativeSaved(points: readonly StatsPoint[]): number[] {
  let total = 0;
  return points.map((p) => {
    total = Math.max(0, total + p.bytes_saved);
    return total;
  });
}

/** SVG path data for a line and its closed area, scaled into a `w`×`h` box. */
export function areaPaths(
  values: readonly number[],
  w: number,
  h: number,
  pad = 4,
): { line: string; area: string; points: { x: number; y: number }[] } {
  if (values.length === 0) return { line: "", area: "", points: [] };
  const max = Math.max(...values, 1);
  const innerH = h - pad * 2;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: values.length > 1 ? i * step : w / 2,
    y: pad + innerH - (v / max) * innerH,
  }));
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const area = `${line} L${last.x.toFixed(1)},${h} L${first.x.toFixed(1)},${h} Z`;
  return { line, area, points };
}

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface HeatCell {
  date: string;
  jobs: number;
  /** 0 = no activity … 4 = busiest day in the window. */
  level: 0 | 1 | 2 | 3 | 4;
  col: number;
  row: number;
}

/**
 * Lay the last `weeks` weeks out as a calendar grid (Monday-first columns), one cell
 * per day, ending on `end`. Days after `end` in the final week are omitted.
 */
export function heatmapCells(
  points: readonly StatsPoint[],
  weeks = 26,
  end: Date = new Date(),
): HeatCell[] {
  const byDay = new Map(points.map((p) => [p.t, p.jobs]));
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const endRow = (endDay.getDay() + 6) % 7; // Monday = 0
  const start = new Date(endDay);
  start.setDate(endDay.getDate() - endRow - (weeks - 1) * 7);

  const days: { date: string; jobs: number; col: number; row: number }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > endDay) break;
    days.push({
      date: isoDay(d),
      jobs: byDay.get(isoDay(d)) ?? 0,
      col: Math.floor(i / 7),
      row: i % 7,
    });
  }
  const max = Math.max(...days.map((d) => d.jobs), 0);
  return days.map((d) => ({
    ...d,
    level:
      d.jobs === 0 || max === 0 ? 0 : (Math.min(4, Math.ceil((d.jobs / max) * 4)) as 1 | 2 | 3 | 4),
  }));
}

/** "1.24 TB" → { value: "1.24", unit: "TB" } for display at two sizes. */
export function splitSize(bytes: number): { value: string; unit: string } {
  const [value = "0", unit = "B"] = formatSize(Math.max(0, bytes)).split(" ");
  return { value, unit };
}

/** "3 h 20 min", "45 min", "under a minute". */
export function formatDurationWords(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Share of the original size that was removed, e.g. 0.39 → "39%". */
export function savedShare(bytesIn: number, bytesOut: number): number {
  if (bytesIn <= 0) return 0;
  return Math.max(0, Math.min(1, (bytesIn - bytesOut) / bytesIn));
}
