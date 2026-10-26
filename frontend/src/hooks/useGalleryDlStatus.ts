import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";

/** gallery-dl install/version state for the Galleries page + the Update action. */
export function useGalleryDlStatus() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.galleryDlInfo(),
    queryFn: () => api.galleryDlInfo(),
  });
  // Asked of the pip yt-dlp (gallery-dl's ytdl backend), not the Downloads binary. The probe
  // spawns a subprocess, so it loads a moment after the page does; [] hides the control.
  const { data: impTargets } = useQuery({
    queryKey: qk.galleryYtdlImpersonateTargets(),
    queryFn: () => api.galleryYtdlImpersonateTargets(),
    enabled: !!data?.installed,
  });
  const mut = useMutation({
    mutationFn: () => api.galleryDlUpdate(),
    // the update also upgrades yt-dlp, which can change what's installed / available
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.galleryDlInfo() }),
        qc.invalidateQueries({ queryKey: qk.galleryYtdlImpersonateTargets() }),
      ]),
  });
  return {
    missing: data ? !data.installed : false,
    version: data?.version ?? null,
    impersonateTargets: impTargets?.targets ?? [],
    updating: mut.isPending,
    update: () => mut.mutate(),
  };
}
