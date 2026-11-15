import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, subtitlesApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import { useConfirm } from "@/components/ConfirmProvider";
import type { ManageAction } from "@/lib/subtitleManage";
import type { TidyMode } from "@/types/subtitle";

const TIDY_WORDS: Record<TidyMode, string> = {
  generated_translated: "generated or translated",
  extra_versions: "extra version",
  originals: "sync backup",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface ManageUi {
  compare: (videoPath: string, file: Extract<ManageAction, { type: "compare" }>["file"]) => void;
  rename: (videoPath: string, file: Extract<ManageAction, { type: "rename" }>["file"]) => void;
  find: (videoPath: string) => void;
  translate: (videoPath: string) => void;
  generate: (videoPath: string) => void;
}

/**
 * The writes of the Manage panel and of the Compare sheet's existing mode: make main,
 * delete, restore, tidy up, one-file sync, rename. Every destructive one asks `useConfirm`
 * with a count first; a "no" changes nothing. After a write the video's file list, the
 * folder scan and the unmatched list are read again so the panel and the Home view show
 * it at once. `act` resolves true when the action was carried out. What needs a dialog or
 * another view (compare, rename, find, translate, generate) goes to the page's `ui`.
 * Server refusals are toasted, except a rename's, which the rename dialog shows itself.
 */
export function useSubtitleManage({ folder, ui }: { folder: string | null; ui: ManageUi }) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const refresh = (videoPath: string) => {
    void qc.invalidateQueries({ queryKey: qk.subtitleFiles(videoPath) });
    void qc.invalidateQueries({ queryKey: qk.subtitleTracks(videoPath) });
    if (folder !== null) {
      void qc.invalidateQueries({ queryKey: qk.subtitleScan(folder) });
      void qc.invalidateQueries({ queryKey: qk.subtitleUnmatched(folder) });
    }
  };
  const fail = (e: unknown, fallback: string) => {
    toast.error(getErrorMessage(e, fallback));
    return false;
  };

  const act = async (video: { path: string; name: string }, a: ManageAction): Promise<boolean> => {
    switch (a.type) {
      case "compare":
        ui.compare(video.path, a.file);
        return true;
      case "rename":
        ui.rename(video.path, a.file);
        return true;
      case "find":
        ui.find(video.path);
        return true;
      case "translate":
        ui.translate(video.path);
        return true;
      case "generate":
        ui.generate(video.path);
        return true;
      case "sync":
        try {
          await subtitlesApi.syncFile(video.path, undefined, {
            subtitle_path: a.path,
            engine: a.engine,
          });
          void qc.invalidateQueries({ queryKey: qk.subtitleActive() });
          void qc.invalidateQueries({ queryKey: qk.jobs() });
          toast.success("Sync queued for this subtitle.");
          return true;
        } catch (e) {
          return fail(e, "Could not start the sync");
        }
      case "make_main":
        try {
          await subtitlesApi.makeMain(video.path, a.path);
          refresh(video.path);
          toast.success("Made the main subtitle.");
          return true;
        } catch (e) {
          return fail(e, "Could not make this the main subtitle");
        }
      case "restore":
        if (
          !(await confirm({
            title: "Restore the original timing?",
            description:
              "The synced subtitle is replaced by the backup taken before its first sync. The backup is used up.",
            confirmText: "Restore",
            destructive: true,
          }))
        )
          return false;
        try {
          await subtitlesApi.restoreOriginal(video.path, a.path);
          refresh(video.path);
          return true;
        } catch (e) {
          return fail(e, "Could not restore the original");
        }
      case "delete": {
        const n = a.paths.length;
        if (
          !(await confirm({
            title: `Delete ${plural(n, "subtitle file", "subtitle files")}?`,
            description: "They are removed from the disk and cannot be restored from here.",
            confirmText: "Delete",
            destructive: true,
          }))
        )
          return false;
        try {
          await subtitlesApi.remove(video.path, a.paths);
          refresh(video.path);
          return true;
        } catch (e) {
          return fail(e, "Could not delete the subtitle");
        }
      }
      case "tidy":
        if (
          !(await confirm({
            title: `Delete ${plural(a.count, `${TIDY_WORDS[a.what]} file`, `${TIDY_WORDS[a.what]} files`)}?`,
            description: `This removes them from the disk for ${video.name}.`,
            confirmText: "Delete",
            destructive: true,
          }))
        )
          return false;
        try {
          await subtitlesApi.tidy([video.path], a.what);
          refresh(video.path);
          return true;
        } catch (e) {
          return fail(e, "Could not tidy up");
        }
    }
  };

  /** Rejects with the server's message, which the rename dialog shows. */
  const rename = async (
    video: { path: string; name: string },
    subtitlePath: string,
    newName: string,
  ) => {
    const r = await subtitlesApi.rename(video.path, subtitlePath, newName);
    refresh(video.path);
    if (r.outside_view)
      toast.info("Renamed. This page no longer lists it as a subtitle for this video.");
  };

  return { act, rename };
}
