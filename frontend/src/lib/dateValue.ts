/**
 * Value of a `date_offset` filter field: either a relative age ("30 days ago")
 * or an absolute calendar date picked from the calendar.
 */
export type DateValue = { n: number; unit: string } | { date: string };

const UNIT_SECONDS: Record<string, number> = {
  days: 86400,
  weeks: 604800,
  months: 2592000,
};

export function isAbsoluteDate(v: DateValue): v is { date: string } {
  return "date" in v;
}

/** Local-midnight start of a `YYYY-MM-DD` string, as a Date. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unix-seconds cutoff a row's timestamp is compared against. */
export function dateCutoffSeconds(v: DateValue, nowSeconds = Date.now() / 1000): number {
  if (isAbsoluteDate(v)) return parseIsoDate(v.date).getTime() / 1000;
  return nowSeconds - v.n * (UNIT_SECONDS[v.unit] ?? 86400);
}

/** Short text for the filter chip: "30 days" or "2024-05-01". */
export function formatDateValue(v: DateValue): string {
  return isAbsoluteDate(v) ? v.date : `${v.n} ${v.unit}`;
}
