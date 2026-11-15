import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { subtitlesApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import type { CompareVerdict } from "@/components/subtitles/CompareSheet";
import type {
  Candidate,
  LengthResult,
  PlanRowState,
  PlanVerdict,
  RunItem,
  ScanFile,
  SubtitleFileInfo,
} from "@/types/subtitle";

type Open =
  | {
      kind: "existing";
      video: { path: string; name: string };
      file: SubtitleFileInfo;
      /** Found beside no video: read and deleted through the folder-scoped calls. */
      stray: boolean;
    }
  | { kind: "row"; row: PlanRowState }
  | { kind: "item"; item: RunItem; video: ScanFile; candidates: Candidate[] };

/**
 * The Compare sheet's page state: which plan row or failed run item it is open for, and what
 * a verdict does. A plan row's verdict goes back into the plan; "Pick another" on a failed run
 * item searches that one video again (read-only) and a verdict queues it as a new run. Nothing
 * is written by opening or closing the sheet. A failed search is toasted with the server's
 * message; while one runs (`searchingItem`) another cannot start.
 */
export function useSubtitleCompare({
  files,
  chooseCandidate,
  setVerdict,
  retry,
  onExisting,
}: {
  /** What an existing subtitle's Sync, Find another and Delete do; resolves true when carried out. */
  onExisting: (
    verdict: "sync" | "find_another" | "delete",
    video: { path: string; name: string },
    file: SubtitleFileInfo,
    stray: boolean,
  ) => Promise<boolean>;
  files: ScanFile[];
  chooseCandidate: (
    key: string,
    candidate: Candidate,
    verdict: PlanVerdict,
    length?: LengthResult,
  ) => void;
  setVerdict: (key: string, verdict: PlanVerdict) => void;
  retry: (item: RunItem) => void;
}) {
  const [open, setOpen] = useState<Open | null>(null);

  const find = useMutation({
    meta: { skipErrorToast: true },
    mutationFn: async (item: RunItem) => {
      const video = files.find((f) => f.path === item.video_path);
      if (!video) throw new Error("This video is not in the folder any more.");
      const res = await subtitlesApi.search({
        video_path: video.path,
        identity: {
          title: video.title,
          year: video.year,
          type: video.media_type === "episode" ? "tv" : "movie",
        },
        languages: [item.language],
        providers: ["subf2m", "yts"],
        ...(video.season != null ? { season: video.season } : {}),
        ...(video.episode != null ? { episode: video.episode } : {}),
      });
      const failed = (c: Candidate) =>
        c.provider === item.provider && c.subtitle_id === item.subtitle_id;
      return { item, video, candidates: res.candidates.filter((c) => !failed(c)) };
    },
    onSuccess: ({ item, video, candidates }) => setOpen({ kind: "item", item, video, candidates }),
    onError: (e) => toast.error(getErrorMessage(e, "Could not search for another subtitle")),
  });

  const close = () => setOpen(null);

  const verdict = (
    v: CompareVerdict,
    candidate?: Candidate,
    length?: LengthResult,
  ): void | Promise<void> => {
    if (open?.kind === "existing") {
      // Keep only closes. Sync and Find another act and close; Delete asks first, and a
      // "no" leaves the sheet open.
      if (v !== "sync" && v !== "find_another" && v !== "delete") return close();
      const { video, file, stray } = open;
      return onExisting(v, video, file, stray).then((done) => {
        if (v !== "delete" || done) close();
      });
    }
    if (!open || !candidate) return;
    if (open.kind === "row") {
      // Not this one only marks the row; it never reorders it or touches its length.
      if (v === "skip") setVerdict(open.row.key, "skip");
      else if (v === "use" || v === "use_and_sync")
        chooseCandidate(open.row.key, candidate, v, length);
      else return;
      close();
      return;
    }
    if (v === "use" || v === "use_and_sync") {
      retry({
        ...open.item,
        provider: candidate.provider,
        subtitle_id: candidate.subtitle_id,
        sync: v === "use_and_sync",
      });
    }
    close();
  };

  const sheet =
    open?.kind === "row"
      ? {
          mode: "candidate" as const,
          video: { path: open.row.video, name: open.row.filename },
          candidates: open.row.candidates,
          existing: undefined,
          stray: false,
        }
      : open?.kind === "item"
        ? {
            mode: "candidate" as const,
            video: { path: open.video.path, name: open.video.filename },
            candidates: open.candidates,
            existing: undefined,
            stray: false,
          }
        : open?.kind === "existing"
          ? {
              mode: "existing" as const,
              video: open.video,
              candidates: [] as Candidate[],
              existing: open.file,
              stray: open.stray,
            }
          : null;

  return {
    sheet,
    /** Compare a subtitle file the video already has (Keep, Sync, Find another, Delete). */
    openExisting: (video: { path: string; name: string }, file: SubtitleFileInfo, stray = false) =>
      setOpen({ kind: "existing", video, file, stray }),
    openRow: (row: PlanRowState) => setOpen({ kind: "row", row }),
    openItem: (item: RunItem) => {
      const same =
        find.variables?.video_path === item.video_path && find.variables.language === item.language;
      if (!(find.isPending && same)) find.mutate(item);
    },
    /** The run item whose search is in flight, else null. */
    searchingItem: find.isPending ? find.variables : null,
    verdict,
    close,
  };
}
