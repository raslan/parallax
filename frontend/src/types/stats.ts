/** Shapes returned by `/api/stats/*` (see `backend/app/api/stats.py`). */

/** @public */
export interface StatsSummary {
  jobs: number;
  jobs_completed: number;
  files: number;
  bytes_in: number;
  bytes_out: number;
  /** in − out across completed jobs; negative when files grew. */
  bytes_saved: number;
  media_seconds: number;
  busy_seconds: number;
  first_event: string | null;
}

/** @public */
export interface StatsPoint {
  /** Bucket start, `YYYY-MM-DD`. */
  t: string;
  jobs: number;
  files: number;
  bytes_saved: number;
}

/** @public */
export interface StatsBreakdownRow {
  key: string;
  jobs: number;
  files: number;
  bytes_saved: number;
}

/** @public */
export type StatsBucket = "day" | "week" | "month";
/** @public */
export type StatsBreakdownBy = "kind" | "media" | "status";
