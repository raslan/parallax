import { useCallback, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { qk, subtitlesApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";
import { languageName } from "@/lib/subtitle-langs";
import { sourceName } from "@/lib/subtitleRunDock";
import { cn } from "@/lib/utils";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type {
  Candidate,
  LengthResult,
  PreviewInfo,
  ReleaseToken,
  SubtitleFileInfo,
} from "@/types/subtitle";
import { ComparePlayer } from "./ComparePlayer";
import { SeasonPackTag } from "./SeasonPackTag";
import { currentLineIndex } from "@/lib/subtitleLines";
import { LineList } from "./LineList";

export type CompareVerdict =
  "use" | "use_and_sync" | "skip" | "keep" | "sync" | "find_another" | "delete";

function TokenChip({ token }: { token: ReleaseToken }) {
  if (!token.value) return null;
  return (
    <span
      data-match={String(token.match)}
      className={cn(
        "rounded border px-1 text-3xs",
        token.match === true && "border-emerald-500/50 text-emerald-500",
        token.match === false && "border-amber-500/50 text-amber-500",
        token.match === null && "text-muted-foreground",
      )}
    >
      {token.value}
    </span>
  );
}

/** What the length check said about the shown candidate: a hint, never a block. */
function LengthNote({ info }: { info: PreviewInfo }) {
  if (info.length === "short" || info.length === "long")
    return (
      <p className="text-xs text-amber-500">
        ends at {formatDuration(info.last)}
        {info.video_duration ? `, video is ${formatDuration(info.video_duration)}` : ""}
      </p>
    );
  if (info.length === "ok")
    return (
      <p className="text-xs text-muted-foreground">
        length ✓ {formatDuration(info.last)}
        {info.video_duration ? ` of ${formatDuration(info.video_duration)}` : ""}
      </p>
    );
  return <p className="text-xs text-muted-foreground">length unknown</p>;
}

/**
 * Compare: see it, hear it, click a line. A right-hand non-modal panel (a bottom sheet below
 * `md`) that plays the raw subtitle candidate over the video, lists its lines (a click seeks)
 * and takes the verdict. Nothing is written beside the video here: it only previews (a
 * temporary copy) and reads release tokens; the caller acts on the verdict. A length result
 * suggests, it never disables a verdict.
 */
type CompareSheetProps = {
  /** Set when `existing` is a subtitle found beside no video, in this folder. */
  unmatchedRoot?: string;
  /** `season` and `episode` let a season pack give only this episode's file. */
  video: { path: string; name: string; season?: number | null; episode?: number | null };
  mode: "candidate" | "existing";
  candidates?: Candidate[];
  existing?: SubtitleFileInfo;
  /** `length` is the shown candidate's length result, when its preview has loaded. */
  onVerdict: (v: CompareVerdict, candidate?: Candidate, length?: LengthResult) => void;
  onClose: () => void;
};

/**
 * Names what the sheet is open for (a match row, a run item, an existing file). The sheet is
 * non-modal, so it can be re-opened for another row of the same video while it is open; a new
 * id starts it afresh (first candidate, no stale line or seek).
 */
export function CompareSheet({ sheetId, ...props }: CompareSheetProps & { sheetId?: string }) {
  return <CompareSheetBody key={sheetId ?? ""} {...props} />;
}

function CompareSheetBody({
  video,
  mode,
  candidates = [],
  existing,
  unmatchedRoot,
  onVerdict,
  onClose,
}: CompareSheetProps) {
  const [index, setIndex] = useState(0);
  // Only the index of the line the player is on: it changes a few times a minute, the player's
  // time ~4 times a second.
  const [current, setCurrent] = useState(-1);
  const [seek, setSeek] = useState<{ time: number; nonce: number }>();
  const candidate = mode === "candidate" ? candidates[index] : undefined;

  const candidateQ = useQuery({
    queryKey: qk.subtitlePreview(
      video.path,
      candidate?.provider ?? "",
      candidate?.subtitle_id ?? "",
      candidate?.language ?? "",
      video.season,
      video.episode,
    ),
    queryFn: () =>
      subtitlesApi.preview({
        video_path: video.path,
        provider: candidate?.provider ?? "subf2m",
        subtitle_id: candidate?.subtitle_id ?? "",
        language: candidate?.language ?? "",
        ...(video.season != null ? { season: video.season } : {}),
        ...(video.episode != null ? { episode: video.episode } : {}),
      }),
    enabled: !!candidate,
    staleTime: Infinity,
    retry: false,
  });
  const tokenQs = useQueries({
    queries: candidates.map((c) => ({
      queryKey: qk.subtitleReleaseTokens(c.release, video.name),
      queryFn: () => subtitlesApi.releaseTokens(c.release, video.name),
      staleTime: Infinity,
    })),
  });
  // An existing subtitle is read through the same temporary preview as a candidate, so the
  // video plays that one file (not every track it has) and its lines are listed.
  // A subtitle found beside no video is read through the folder-scoped call.
  const existingQ = useQuery({
    queryKey: unmatchedRoot
      ? qk.subtitleUnmatchedPreview(unmatchedRoot, existing?.path ?? "", video.path)
      : qk.subtitleExistingPreview(video.path, existing?.path ?? ""),
    queryFn: () =>
      unmatchedRoot
        ? subtitlesApi.unmatchedPreview(unmatchedRoot, existing?.path ?? "", video.path)
        : subtitlesApi.existingPreview(video.path, existing?.path ?? ""),
    enabled: mode === "existing" && !!existing,
    staleTime: Infinity,
    retry: false,
  });
  const previewQ = mode === "existing" ? existingQ : candidateQ;

  const preview = previewQ.data;
  const trackLanguage = mode === "existing" ? existing?.language : candidate?.language;
  const extraTracks = useMemo(
    () =>
      preview
        ? [
            {
              label: trackLanguage ? languageName(trackLanguage) : "Subtitle",
              lang: trackLanguage ?? "und",
              url: subtitlesApi.previewVttUrl(preview.preview_id),
            },
          ]
        : undefined,
    [preview, trackLanguage],
  );

  const onTime = useCallback(
    (t: number) => setCurrent(currentLineIndex(preview?.lines ?? [], t)),
    [preview],
  );
  const onSeek = useCallback(
    (t: number) => setSeek((s) => ({ time: t, nonce: (s?.nonce ?? 0) + 1 })),
    [],
  );
  const lengthOf: LengthResult | undefined = preview
    ? { length: preview.length, last: preview.last, videoDuration: preview.video_duration }
    : undefined;

  const pick = (i: number) => {
    setIndex(i);
    setSeek(undefined);
    setCurrent(-1);
  };

  return (
    <Sheet open modal={false} onOpenChange={(o) => !o && onClose()}>
      <PanelSheetContent
        overlay={false}
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-[26rem] max-w-full overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Compare subtitles</SheetTitle>
          <SheetDescription className="truncate" title={video.name}>
            {video.name}
          </SheetDescription>
        </SheetHeader>

        <ComparePlayer
          path={video.path}
          extraTracks={extraTracks}
          seekRequest={seek}
          onTime={onTime}
        />

        {mode === "candidate" && (
          <>
            <div
              role="radiogroup"
              aria-label="Candidates"
              className="max-h-48 shrink-0 space-y-1 overflow-y-auto"
            >
              {candidates.map((c, i) => {
                const tokens = tokenQs[i]?.data;
                return (
                  <button
                    key={`${c.provider}:${c.subtitle_id}`}
                    type="button"
                    role="radio"
                    aria-checked={i === index}
                    onClick={() => pick(i)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md border px-2 py-1 text-left text-xs",
                      i === index ? "border-primary bg-primary/10" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="truncate" title={c.release}>
                      {c.release}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
                      <span>{sourceName(c.provider)}</span>
                      <SeasonPackTag candidate={c} />
                      {c.hearing_impaired && <span>hearing impaired</span>}
                      {tokens && (
                        <>
                          <TokenChip token={tokens.resolution} />
                          <TokenChip token={tokens.source} />
                          <TokenChip token={tokens.group} />
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">No other subtitles found</p>
            )}
          </>
        )}
        {mode === "existing" && existing && (
          <p className="text-xs text-muted-foreground" title={existing.path}>
            {existing.name}
          </p>
        )}
        {(mode === "existing" ? !!existing : !!candidate) && (
          <>
            {previewQ.isPending && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading this subtitle…
              </p>
            )}
            {previewQ.isError && (
              <div className="space-y-2">
                <p role="alert" className="text-xs text-destructive">
                  {getErrorMessage(previewQ.error, "Could not load this subtitle")}
                </p>
                <Button size="sm" variant="outline" onClick={() => void previewQ.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {preview && (
              <>
                <LengthNote info={preview} />
                <LineList lines={preview.lines} current={current} onSeek={onSeek} />
              </>
            )}
          </>
        )}

        {/* Pinned to the bottom of the scrolling sheet so a verdict is always in reach. */}
        {(mode === "existing" || candidate) && (
          <div
            role="group"
            aria-label="Verdict"
            className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex flex-wrap gap-2 border-t bg-px-elevated px-4 py-3"
          >
            {mode === "candidate" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => candidate && onVerdict("use", candidate, lengthOf)}
                >
                  Use this
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => candidate && onVerdict("use_and_sync", candidate, lengthOf)}
                >
                  Matches, needs sync
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => candidate && onVerdict("skip", candidate, lengthOf)}
                >
                  Not this one
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => onVerdict("keep")}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!unmatchedRoot}
                  title={
                    unmatchedRoot
                      ? "No video owns this file. Rename it so it is named for the video first."
                      : undefined
                  }
                  onClick={() => onVerdict("sync")}
                >
                  Sync
                </Button>
                <Button size="sm" variant="outline" onClick={() => onVerdict("find_another")}>
                  Find another
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onVerdict("delete")}>
                  Delete
                </Button>
              </>
            )}
          </div>
        )}
      </PanelSheetContent>
    </Sheet>
  );
}
