import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, subtitlesApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import type { CompareVerdict } from "@/components/subtitles/CompareSheet";
import type {
  Candidate,
  Identity,
  LengthResult,
  MatchRowState,
  MatchVerdict,
  RunItem,
  ScanFile,
  SubtitleFileInfo,
  SubtitleProvider,
} from "@/types/subtitle";

type Open =
  | {
      kind: "existing";
      video: { path: string; name: string };
      file: SubtitleFileInfo;
      /** Found beside no video: read and deleted through the folder-scoped calls. */
      stray: boolean;
    }
  | { kind: "row"; row: MatchRowState }
  | { kind: "item"; item: RunItem; video: ScanFile; candidates: Candidate[] };

/**
 * The Compare sheet's page state: which match row or failed run item it is open for, and what
 * a verdict does. A match row's verdict goes back into the matches; "Pick another" on a failed run
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
  searchFor,
}: {
  /** What to search for to list a row's whole candidate list; null when the page cannot say. */
  searchFor: (row: MatchRowState) => { identity: Identity; providers: SubtitleProvider[] } | null;
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
    verdict: MatchVerdict,
    length?: LengthResult,
  ) => void;
  setVerdict: (key: string, verdict: MatchVerdict) => void;
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

  // A search job keeps only a row's best five. Compare asks the sources for the whole list
  // (one read-only search, cached on the server for ten minutes) and shows it after the five;
  // if that fails the five stay, quietly.
  const openRow = open?.kind === "row" ? open.row : null;
  const rowSearch = openRow ? searchFor(openRow) : null;
  const fullQ = useQuery({
    queryKey: qk.subtitleRowSearch(
      openRow?.video ?? "",
      openRow?.language ?? "",
      rowSearch?.providers ?? [],
      rowSearch?.identity ?? null,
      openRow?.season,
      openRow?.episode,
    ),
    queryFn: () =>
      subtitlesApi.search({
        video_path: openRow?.video ?? "",
        identity: rowSearch?.identity as Identity,
        languages: [openRow?.language ?? ""],
        providers: rowSearch?.providers ?? [],
        ...(openRow?.season != null ? { season: openRow.season } : {}),
        ...(openRow?.episode != null ? { episode: openRow.episode } : {}),
      }),
    enabled: openRow !== null && rowSearch !== null,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const rowCandidates = useMemo(() => {
    if (!openRow) return [];
    const own = openRow.candidates;
    if (!fullQ.data) return own;
    const has = (c: Candidate) =>
      own.some((o) => o.provider === c.provider && o.subtitle_id === c.subtitle_id);
    return [...own, ...fullQ.data.candidates.filter((c) => !has(c))];
  }, [openRow, fullQ.data]);

  const sheet =
    open?.kind === "row"
      ? {
          id: `row:${open.row.key}`,
          mode: "candidate" as const,
          video: {
            path: open.row.video,
            name: open.row.filename,
            season: open.row.season,
            episode: open.row.episode,
          },
          candidates: rowCandidates,
          existing: undefined,
          stray: false,
        }
      : open?.kind === "item"
        ? {
            id: `item:${open.item.video_path}|${open.item.language}`,
            mode: "candidate" as const,
            video: {
              path: open.video.path,
              name: open.video.filename,
              season: open.video.season,
              episode: open.video.episode,
            },
            candidates: open.candidates,
            existing: undefined,
            stray: false,
          }
        : open?.kind === "existing"
          ? {
              id: `existing:${open.video.path}|${open.file.path}`,
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
    openRow: (row: MatchRowState) => setOpen({ kind: "row", row }),
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
