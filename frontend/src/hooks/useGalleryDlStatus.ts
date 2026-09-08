import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";

/** gallery-dl install/version state for the Galleries page + the Update action. */
export function useGalleryDlStatus() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.galleryDlInfo(),
    queryFn: () => api.galleryDlInfo(),
  });
  const mut = useMutation({
    mutationFn: () => api.galleryDlUpdate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.galleryDlInfo() }),
  });
  return {
    missing: data ? !data.installed : false,
    version: data?.version ?? null,
    updating: mut.isPending,
    update: () => mut.mutate(),
  };
}
