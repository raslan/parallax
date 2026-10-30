import { req } from "./client";
import type {
  StatsBreakdownBy,
  StatsBreakdownRow,
  StatsBucket,
  StatsPoint,
  StatsSummary,
} from "@/types/stats";

/** `days` of 0 (the default) means all time. */
export const statsApi = {
  summary: (days = 0) => req<StatsSummary>(`/stats/summary?days=${days}`),
  // `tz` lets the server cut days where the user lives, not in UTC (heatmap + curve).
  timeseries: (bucket: StatsBucket = "day", days = 0) =>
    req<StatsPoint[]>(
      `/stats/timeseries?bucket=${bucket}&days=${days}&tz=${new Date().getTimezoneOffset()}`,
    ),
  breakdown: (by: StatsBreakdownBy = "kind", days = 0) =>
    req<StatsBreakdownRow[]>(`/stats/breakdown?by=${by}&days=${days}`),
  clear: () => req<void>("/stats", { method: "DELETE" }),
};
