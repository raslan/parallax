import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import type { Job } from "@/types/job";
import { routeLabel } from "@/components/layout/nav-config";

const APP = "Parallax";

/** "(2) Compress · Videos · Parallax" — the count shows progress in a background tab. @public */
export function buildDocumentTitle(label: string | null, activeJobs: number): string {
  const parts = [label, APP].filter(Boolean).join(" · ");
  return activeJobs > 0 ? `(${activeJobs}) ${parts}` : parts;
}

/**
 * Keeps `document.title` in step with the route and the number of running or
 * pending jobs. Reads the shared `qk.jobs()` cache (kept live by the single
 * `useJobsFeed` in the header) rather than opening another stream.
 */
export function useDocumentTitle() {
  const { pathname } = useLocation();
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(),
  });
  const active = jobs.filter((j) => j.status === "running" || j.status === "pending").length;

  useEffect(() => {
    document.title = buildDocumentTitle(routeLabel(pathname), active);
  }, [pathname, active]);
}
