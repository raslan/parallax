export interface CleanupParams {
  duration_op?: "lt" | "gt";
  duration_secs?: number;
  fps_op?: "lt" | "gt";
  fps_val?: number;
  date_op?: "before" | "after";
  date_ts?: number;
  height_op?: "lt" | "gt";
  height_val?: number;
}
