import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { subtitlesApi } from "@/lib/api";
import type { CompareVerdict } from "@/components/subtitles/CompareSheet";
import type { Candidate, PlanRowState, PlanVerdict, RunItem, ScanFile } from "@/types/subtitle";

type Open =
  | { kind: "row"; row: PlanRowState }
  | { kind: "item"; item: RunItem; video: ScanFile; candidates: Candidate[] };

/**
 * The Compare sheet's page state: which plan row or failed run item it is open for, and what
 * a verdict does. A plan row's verdict goes back into the plan; "Pick another" on a failed run
 * item searches that one video again (read-only) and a verdict queues it as a new run. Nothing
 * is written by opening or closing the sheet.
 */
export function useSubtitleCompare({
  files,
  chooseCandidate,
  retry,
}: {
  files: ScanFile[];
  chooseCandidate: (key: string, candidate: Candidate, verdict: PlanVerdict) => void;
  retry: (item: RunItem) => void;
}) {
  const [open, setOpen] = useState<Open | null>(null);

  const find = useMutation({
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
  });

  const close = () => setOpen(null);

  const verdict = (v: CompareVerdict, candidate?: Candidate) => {
    if (!open || !candidate) return;
    if (open.kind === "row") {
      if (v === "use" || v === "use_and_sync" || v === "skip") {
        chooseCandidate(open.row.key, candidate, v);
        close();
      }
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
          video: { path: open.row.video, name: open.row.filename },
          candidates: open.row.candidates,
        }
      : open?.kind === "item"
        ? {
            video: { path: open.video.path, name: open.video.filename },
            candidates: open.candidates,
          }
        : null;

  return {
    sheet,
    openRow: (row: PlanRowState) => setOpen({ kind: "row", row }),
    openItem: (item: RunItem) => find.mutate(item),
    searching: find.isPending,
    verdict,
    close,
  };
}
