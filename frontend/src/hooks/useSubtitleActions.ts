import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qk, subtitlesApi } from "@/lib/api";
import { getErrorMessage, httpStatus } from "@/lib/api/client";
import { hasSubtitle } from "@/lib/subtitleCoverage";
import type { ScanFile } from "@/types/subtitle";

/** The server's cap on videos per sync job (`SYNC_FILES_MAX`). */
const SYNC_CHUNK = 500;

/**
 * The Subtitles page's write actions that need no further choices: Sync on the dock and
 * Cancel on the Activity section. Errors go through the shared mutation toast.
 *
 * Sync covers every subtitle of the chosen videos with the Settings engine, as one job
 * (`POST /subtitles/sync-files`, started from the open folder so the Activity section
 * shows it; a selection over the server's 500-video cap goes in several jobs of 500). A
 * video with no subtitle file at all has nothing to sync and is left out, and the toast
 * says how many were.
 */
export function useSubtitleActions(folder: string | null) {
  const qc = useQueryClient();
  const refreshActivity = () => {
    void qc.invalidateQueries({ queryKey: qk.subtitleActive() });
    void qc.invalidateQueries({ queryKey: qk.jobs() });
  };

  const sync = useMutation({
    mutationFn: async (files: ScanFile[]) => {
      const targets = files.filter(hasSubtitle).map((f) => f.path);
      for (let i = 0; i < targets.length; i += SYNC_CHUNK) {
        await subtitlesApi.syncFiles(
          targets.slice(i, i + SYNC_CHUNK),
          folder !== null ? { path: folder } : undefined,
        );
      }
      return { queued: targets.length, left: files.length - targets.length };
    },
    onSuccess: ({ queued, left }) => {
      refreshActivity();
      const none = left > 0 ? ` ${left} had no subtitle to sync.` : "";
      if (queued > 0)
        toast.success(`Sync queued for ${queued} ${queued === 1 ? "video" : "videos"}.${none}`);
      else toast.info("None of these videos has a subtitle to sync.");
    },
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelJob(id),
    onSuccess: refreshActivity,
    // The server answers 400 for a job that is no longer active: it finished while the
    // button was on screen. That is the outcome the user wanted, so say so quietly.
    meta: { skipErrorToast: true },
    onError: (e) => {
      refreshActivity();
      if (httpStatus(e) === 400) toast.info("That job had already finished.");
      else toast.error(getErrorMessage(e, "Could not cancel the job"));
    },
  });

  return {
    sync: (files: ScanFile[]) => sync.mutate(files),
    syncing: sync.isPending,
    cancel: cancel.mutate,
    cancelling: new Set(cancel.isPending && cancel.variables != null ? [cancel.variables] : []),
  };
}
