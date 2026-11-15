import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qk, subtitlesApi } from "@/lib/api";
import type { ScanFile } from "@/types/subtitle";

/** A video with at least one subtitle a sync can work on (a `.original` backup is not one). */
const canSync = (f: ScanFile) => f.subtitles.some((s) => s.kind !== "original");

/**
 * The Subtitles page's write actions that need no further choices: Sync on the dock and
 * Cancel on the Activity section. Errors go through the shared mutation toast.
 *
 * Sync covers every subtitle of the chosen videos with the Settings engine. The whole
 * folder is one job (`sync-bulk`); a part of it is one job per video, since the sync
 * endpoint takes one video. A video with no subtitle file at all has nothing to sync and
 * is left out, and the toast says how many were.
 */
export function useSubtitleActions(folder: string | null) {
  const qc = useQueryClient();
  const refreshActivity = () => {
    void qc.invalidateQueries({ queryKey: qk.subtitleActive() });
    void qc.invalidateQueries({ queryKey: qk.jobs() });
  };

  const sync = useMutation({
    mutationFn: async ({ files, wholeFolder }: { files: ScanFile[]; wholeFolder: boolean }) => {
      const targets = files.filter(canSync);
      if (targets.length > 0) {
        if (wholeFolder && folder !== null) await subtitlesApi.syncBulk(folder);
        else for (const f of targets) await subtitlesApi.syncFile(f.path);
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
  });

  return {
    sync: (files: ScanFile[], wholeFolder: boolean) => sync.mutate({ files, wholeFolder }),
    syncing: sync.isPending,
    cancel: cancel.mutate,
    cancelling: new Set(cancel.isPending && cancel.variables != null ? [cancel.variables] : []),
  };
}
