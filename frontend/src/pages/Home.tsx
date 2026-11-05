import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  Captions,
  Combine,
  Copy,
  Download,
  Minimize2,
  Scissors,
  ShieldAlert,
  Wand2,
  Wrench,
} from "lucide-react";
import { QueryError } from "@/components/QueryError";
import { ListSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ActivityHeatmap } from "@/components/dashboard/ActivityHeatmap";
import { OperationBars } from "@/components/dashboard/OperationBars";
import { QuickStart, type QuickStartItem } from "@/components/dashboard/QuickStart";
import { RightNow, type LibraryCount } from "@/components/dashboard/RightNow";
import { SavedHero } from "@/components/dashboard/SavedHero";
import { SavingsChart } from "@/components/dashboard/SavingsChart";
import { api, audioLibrariesApi, imageApi, qk, statsApi } from "@/lib/api";
import {
  DEFAULT_RANGE,
  RANGES,
  heatmapCells,
  isRangeKey,
  rangeOf,
  type RangeKey,
} from "@/lib/dashboard";
import type { Job } from "@/types/job";

const RANGE_STORAGE_KEY = "parallax-home-range";

function loadRange(): RangeKey {
  try {
    const stored = localStorage.getItem(RANGE_STORAGE_KEY);
    return isRangeKey(stored) ? stored : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

// Every route here is a nav page. Galleries is in the nav but not offered as a quick start.
const QUICK_START: readonly QuickStartItem[] = [
  {
    to: "/compress",
    icon: Minimize2,
    title: "Shrink videos",
    hint: "Re-encode a folder to H.264, HEVC or AV1.",
  },
  {
    to: "/duplicates",
    icon: Copy,
    title: "Find duplicate videos",
    hint: "Match by size, length, visuals or audio.",
  },
  {
    to: "/cleanup",
    icon: Scissors,
    title: "Clean out a folder",
    hint: "Delete files that match a filter you build.",
  },
  {
    to: "/toolbox",
    icon: Wrench,
    title: "Fix videos",
    hint: "Trim, rotate, repair audio or sync.",
  },
  {
    to: "/splice",
    icon: Combine,
    title: "Merge videos",
    hint: "Join several clips into one file.",
  },
  {
    to: "/audio-compress",
    icon: AudioLines,
    title: "Shrink audio",
    hint: "Opus, AAC or MP3 at a target bitrate.",
  },
  {
    to: "/content-review",
    icon: ShieldAlert,
    title: "Review images",
    hint: "Flag and quarantine by detected content.",
  },
  {
    to: "/subtitles",
    icon: Captions,
    title: "Get subtitles",
    hint: "Download, generate or re-time them.",
  },
  {
    to: "/identify",
    icon: Wand2,
    title: "Rename for Plex or Jellyfin",
    hint: "Match files to a show or movie.",
  },
  {
    to: "/downloads",
    icon: Download,
    title: "Download a video",
    hint: "Queue links through yt-dlp.",
  },
];

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-px-surface p-5 ${className ?? ""}`}>
      <h2 className="mb-4 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function Home() {
  const [rangeKey, setRangeKey] = useState<RangeKey>(loadRange);
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, rangeKey);
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  }, [rangeKey]);

  const range = rangeOf(rangeKey);
  const lifetime = useQuery({ queryKey: qk.statsSummary(0), queryFn: () => statsApi.summary(0) });
  const summary = useQuery({
    queryKey: qk.statsSummary(range.days),
    queryFn: () => statsApi.summary(range.days),
  });
  // The window before this one = last 2N days minus last N days.
  const doubled = useQuery({
    queryKey: qk.statsSummary(range.days * 2),
    queryFn: () => statsApi.summary(range.days * 2),
    enabled: range.days > 0,
  });
  const series = useQuery({
    queryKey: qk.statsTimeseries(range.bucket, range.days),
    queryFn: () => statsApi.timeseries(range.bucket, range.days),
  });
  const heat = useQuery({
    queryKey: qk.statsTimeseries("day", 182),
    queryFn: () => statsApi.timeseries("day", 182),
  });
  const breakdown = useQuery({
    queryKey: qk.statsBreakdown("kind", range.days),
    queryFn: () => statsApi.breakdown("kind", range.days),
  });

  const jobs = useQuery<Job[]>({ queryKey: qk.jobs(), queryFn: () => api.getJobs() });
  const video = useQuery({ queryKey: qk.libraries(), queryFn: () => api.getLibraries() });
  const image = useQuery({
    queryKey: qk.imageLibraries(),
    queryFn: () => imageApi.listLibraries(),
  });
  const audio = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
  });

  const heatCells = useMemo(() => heatmapCells(heat.data ?? []), [heat.data]);
  const active = (jobs.data ?? []).filter((j) => j.status === "running" || j.status === "pending");
  const recent = (jobs.data ?? [])
    .filter(
      (j) => ["completed", "failed", "cancelled"].includes(j.status) && j.type !== "thumbnail_warm",
    )
    .slice(0, 4);
  const libraries: LibraryCount[] = [
    { label: "video", count: video.data?.length ?? 0, to: "/libraries" },
    { label: "image", count: image.data?.length ?? 0, to: "/image-libraries" },
    { label: "audio", count: audio.data?.length ?? 0, to: "/audio-libraries" },
  ];

  const previousSaved =
    range.days > 0 && doubled.data && summary.data
      ? Math.max(0, doubled.data.bytes_saved - summary.data.bytes_saved)
      : null;

  const failed = lifetime.error ?? summary.error;
  const firstRun = lifetime.data?.jobs === 0;

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What Parallax has done for your storage, and where to go next.
          </p>
        </div>
        {!firstRun && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={rangeKey}
            onValueChange={(v) => isRangeKey(v) && setRangeKey(v)}
            aria-label="Time range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.key} value={r.key}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {failed ? (
        <QueryError
          error={failed}
          onRetry={() => {
            void lifetime.refetch();
            void summary.refetch();
          }}
        />
      ) : lifetime.isLoading || summary.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <ListSkeleton rows={3} />
        </div>
      ) : firstRun ? (
        <section className="rounded-xl border border-dashed border-border p-8">
          <h2 className="text-lg font-semibold">Nothing recorded yet</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Add a folder, run a tool on it, and the space you recover, the jobs you run and how busy
            you have been will build up here. Statistics are kept even after you remove a library,
            and never include file names.
          </p>
        </section>
      ) : (
        summary.data && (
          <>
            <SavedHero
              summary={summary.data}
              previousSaved={previousSaved}
              rangeLabel={range.label}
            />
            <div className="grid gap-6 lg:grid-cols-12">
              <Panel title="Space saved over time" className="lg:col-span-7">
                {series.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <SavingsChart points={series.data ?? []} />
                )}
              </Panel>
              <Panel title="Work by operation" className="lg:col-span-5">
                <OperationBars rows={breakdown.data ?? []} />
              </Panel>
            </div>
          </>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel title="Start something" className="lg:col-span-7">
          <QuickStart items={QUICK_START} />
        </Panel>
        <div className="space-y-6 lg:col-span-5">
          <Panel title="Right now">
            <RightNow active={active} recent={recent} libraries={libraries} />
          </Panel>
          {!firstRun && (
            <Panel title="Activity, last 26 weeks">
              {heat.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ActivityHeatmap cells={heatCells} />
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
