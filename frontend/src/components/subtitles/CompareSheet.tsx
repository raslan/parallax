import { useMemo, useState } from "react";
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
import type { Candidate, PreviewInfo, ReleaseToken, SubtitleFileInfo } from "@/types/subtitle";
import { ComparePlayer } from "./ComparePlayer";
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
export function CompareSheet({
  video,
  mode,
  candidates = [],
  existing,
  onVerdict,
  onClose,
}: {
  video: { path: string; name: string };
  mode: "candidate" | "existing";
  candidates?: Candidate[];
  existing?: SubtitleFileInfo;
  onVerdict: (v: CompareVerdict, candidate?: Candidate) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ time: number; nonce: number }>();
  const candidate = mode === "candidate" ? candidates[index] : undefined;

  const previewQ = useQuery({
    queryKey: qk.subtitlePreview(
      video.path,
      candidate?.provider ?? "",
      candidate?.subtitle_id ?? "",
      candidate?.language ?? "",
    ),
    queryFn: () =>
      subtitlesApi.preview({
        video_path: video.path,
        provider: candidate?.provider ?? "subf2m",
        subtitle_id: candidate?.subtitle_id ?? "",
        language: candidate?.language ?? "",
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
  // Existing mode plays the video with the subtitles it already has.
  const tracksQ = useQuery({
    queryKey: qk.subtitleTracks(video.path),
    queryFn: () => subtitlesApi.tracks(video.path),
    enabled: mode === "existing",
  });

  const preview = previewQ.data;
  const extraTracks = useMemo(
    () =>
      preview
        ? [
            {
              label: candidate ? languageName(candidate.language) : "Candidate",
              lang: candidate?.language ?? "und",
              url: subtitlesApi.previewVttUrl(preview.preview_id),
            },
          ]
        : undefined,
    [preview, candidate],
  );

  const pick = (i: number) => {
    setIndex(i);
    setSeek(undefined);
    setTime(0);
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
          tracks={mode === "existing" ? tracksQ.data : undefined}
          extraTracks={mode === "candidate" ? extraTracks : undefined}
          seekRequest={seek}
          onTime={setTime}
        />

        {mode === "candidate" && (
          <>
            <div role="radiogroup" aria-label="Candidates" className="space-y-1">
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
                    <span className="break-all">{c.release}</span>
                    <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
                      <span>{sourceName(c.provider)}</span>
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
                <LineList
                  lines={preview.lines}
                  currentTime={time}
                  onSeek={(t) => setSeek((s) => ({ time: t, nonce: (s?.nonce ?? 0) + 1 }))}
                />
              </>
            )}
          </>
        )}
        {mode === "existing" && existing && (
          <p className="text-xs text-muted-foreground" title={existing.path}>
            {existing.name}
          </p>
        )}

        <div role="group" aria-label="Verdict" className="flex flex-wrap gap-2">
          {mode === "candidate" ? (
            <>
              <Button size="sm" onClick={() => candidate && onVerdict("use", candidate)}>
                Use this
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => candidate && onVerdict("use_and_sync", candidate)}
              >
                Matches, needs sync
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => candidate && onVerdict("skip", candidate)}
              >
                Not this one
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => onVerdict("keep")}>
                Keep
              </Button>
              <Button size="sm" variant="outline" onClick={() => onVerdict("sync")}>
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
      </PanelSheetContent>
    </Sheet>
  );
}
