interface DetectedGpu {
  vendor: string;
  label: string;
}

interface NvidiaPackage {
  installed: boolean;
  installed_bytes: number;
  expected_bytes: number;
  versions: Record<string, string>;
  installing_job_id: number | null;
  enabled: boolean;
  /** The "GPUs to use" slider; 0 means all detected cards. */
  gpu_count: number;
  nvidia_gpus: number;
  gpus_in_use: number;
}

export interface HardwareInfo {
  gpus: DetectedGpu[];
  nvidia: NvidiaPackage;
}

export interface GpuCheck {
  ok: boolean;
  devices: number;
  message: string;
}
