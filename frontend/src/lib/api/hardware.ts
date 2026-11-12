import { req } from "./client";
import type { GpuCheck, HardwareInfo } from "@/types/hardware";

export const hardwareApi = {
  get: () => req<HardwareInfo>("/hardware"),
  installNvidia: () => req<{ job_id: number }>("/hardware/nvidia/install", { method: "POST" }),
  removeNvidia: () => req<void>("/hardware/nvidia", { method: "DELETE" }),
  checkNvidia: () => req<GpuCheck>("/hardware/nvidia/check", { method: "POST" }),
};
