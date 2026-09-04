import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";

/**
 * yt-dlp install/version state for the Downloads page: the info + impersonate-
 * targets queries plus the "Update" action. `update()` re-fetches both queries.
 */
export function useYtdlpStatus() {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);

  const { data: ytdlpInfo } = useQuery({
    queryKey: qk.ytdlpInfo(),
    queryFn: () => api.ytdlpInfo(),
  });

  const { data: impTargets } = useQuery({
    queryKey: qk.ytdlpImpersonateTargets(),
    queryFn: () => api.ytdlpImpersonateTargets(),
    enabled: !!ytdlpInfo?.installed,
  });

  const update = async () => {
    setUpdating(true);
    try {
      await api.ytdlpUpdate();
      await queryClient.invalidateQueries({ queryKey: qk.ytdlpInfo() });
      await queryClient.invalidateQueries({ queryKey: qk.ytdlpImpersonateTargets() });
    } catch {
      /* ignore */
    } finally {
      setUpdating(false);
    }
  };

  return {
    missing: ytdlpInfo ? !ytdlpInfo.installed : false,
    version: ytdlpInfo?.version ?? null,
    impersonateTargets: impTargets?.targets ?? [],
    updating,
    update,
  };
}
