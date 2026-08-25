import { req } from "./client";
import type { Job, JobLog } from "@/types/job";

export const jobsApi = {
  getJobs: (limit = 50) => req<Job[]>(`/jobs?limit=${limit}`),
  getJob: (id: number) => req<Job>(`/jobs/${id}`),
  cancelJob: (id: number) => req<{ message: string }>(`/jobs/${id}/cancel`, { method: "POST" }),
  getJobLogs: (id: number) => req<JobLog[]>(`/jobs/${id}/logs`),
  jobsStreamUrl: () => `/api/jobs/stream`,
  clearJobHistory: () => req<void>("/jobs/history", { method: "DELETE" }),
};
