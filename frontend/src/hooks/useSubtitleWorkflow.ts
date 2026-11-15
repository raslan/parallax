import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, subtitlesApi } from "@/lib/api";
import { mergeEntries, parseRunJob, runEntries, type SyncEngine } from "@/lib/subtitleRunDock";
import type { TitleWithFiles } from "@/lib/subtitleGroups";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSubtitlePlan } from "@/hooks/useSubtitlePlan";
import type {
  Identity,
  PlanGroup,
  PlanScope,
  RunEntry,
  RunItem,
  ScanFile,
  SubtitleProvider,
  TitleChoice,
} from "@/types/subtitle";

interface Choice extends TitleChoice {
  videos: ScanFile[];
}

type Workflow =
  | {
      stage: "titles" | "plan";
      choices: Choice[];
      scope: PlanScope;
      /** Wanted and Sources as they were when Find subtitles started: a later change applies to the next search. */
      wanted: string[];
      sources: SubtitleProvider[];
    }
  | { stage: "run"; earlier: RunEntry[] }
  | { stage: "machine"; files: ScanFile[]; keepExisting: boolean };

const NO_GROUPS: PlanGroup[] = [];
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const videos = (n: number) => `${n} ${n === 1 ? "video" : "videos"}`;

export type SubtitleWorkflow = ReturnType<typeof useSubtitleWorkflow>;

/**
 * The temporary workflows of the Subtitles page, over the Home view: Find subtitles
 * (Titles → Plan → Run) and the Generated and translated section opened from the dock.
 * Nothing here is remembered: leaving, or opening another folder, ends it. A run lives on
 * the server, so after a reload it is opened again from Activity (`openRun`), rebuilt
 * from the job's stored plan and results. Write errors go through the shared toast.
 */
export function useSubtitleWorkflow({
  folder,
  titles,
  wanted,
  sources,
}: {
  folder: string | null;
  titles: TitleWithFiles[];
  wanted: string[];
  sources: SubtitleProvider[];
}) {
  const qc = useQueryClient();
  const [wf, setWf] = useState<Workflow | null>(null);
  const poll = useJobPoll();

  // Another folder ends whatever was open (adjusted while rendering).
  const [forFolder, setForFolder] = useState(folder);
  if (forFolder !== folder) {
    setForFolder(folder);
    setWf(null);
  }

  const refreshActivity = () => {
    void qc.invalidateQueries({ queryKey: qk.subtitleActive() });
    void qc.invalidateQueries({ queryKey: qk.jobs() });
  };

  // ---- Titles and Plan ----

  const choices = wf && (wf.stage === "titles" || wf.stage === "plan") ? wf.choices : null;
  const scope = wf && (wf.stage === "titles" || wf.stage === "plan") ? wf.scope : "missing";
  const planning = wf?.stage === "plan";
  const groups = useMemo(
    () =>
      planning && choices
        ? choices
            .filter((c) => !c.skipped)
            .map((c) => ({ key: c.key, identity: c.identity, files: c.videos }))
        : NO_GROUPS,
    [planning, choices],
  );
  const planWanted = wf && (wf.stage === "titles" || wf.stage === "plan") ? wf.wanted : wanted;
  const planSources = wf && (wf.stage === "titles" || wf.stage === "plan") ? wf.sources : sources;
  const plan = useSubtitlePlan({
    groups,
    wanted: planWanted,
    providers: planSources,
    scope,
  });

  /** Starts Find subtitles on these videos, grouped by their titles. */
  const startFind = (files: ScanFile[]) => {
    const paths = new Set(files.map((f) => f.path));
    const picked = titles.flatMap((t): Choice[] => {
      const own = t.files.filter((f) => paths.has(f.path));
      if (own.length === 0) return [];
      const { group } = t;
      return [
        {
          key: group.key,
          group,
          files: own.length,
          videos: own,
          identity: { title: group.title, year: group.year, type: group.type },
          skipped: false,
        },
      ];
    });
    setWf({ stage: "titles", choices: picked, scope: "missing", wanted, sources });
  };

  const editChoices = (fn: (c: Choice) => Choice) =>
    setWf((w) => (w && w.stage === "titles" ? { ...w, choices: w.choices.map(fn) } : w));
  const setIdentity = (key: string, identity: Identity) =>
    editChoices((c) => (c.key === key ? { ...c, identity, confirmed: true } : c));
  /** Titles the file names could not settle ("Pick which one") that the user has not picked yet. */
  const unconfirmed = new Set(
    (choices ?? []).filter((c) => c.group.needs_choice && !c.confirmed).map((c) => c.key),
  );
  const toggleSkip = (key: string) =>
    editChoices((c) => (c.key === key ? { ...c, skipped: !c.skipped } : c));
  const setScope = (s: PlanScope) =>
    setWf((w) => (w && w.stage === "titles" ? { ...w, scope: s } : w));
  const toPlan = () => setWf((w) => (w && w.stage === "titles" ? { ...w, stage: "plan" } : w));
  const toTitles = () => setWf((w) => (w && w.stage === "plan" ? { ...w, stage: "titles" } : w));

  // ---- Run ----

  const run = useMutation({
    mutationFn: (body: {
      items: RunItem[];
      keep_existing: boolean;
      sync_after: boolean;
      engine?: SyncEngine;
    }) => subtitlesApi.run({ path: folder ?? "", ...body }),
    onSuccess: ({ job_id }) => {
      poll.start(job_id);
      refreshActivity();
    },
  });

  const parsed = parseRunJob(poll.job);
  const ended = TERMINAL.has(poll.status ?? "");
  const current = parsed ? runEntries(parsed, ended) : [];
  const entries = wf?.stage === "run" ? mergeEntries(wf.earlier, current) : [];

  const download = (body: {
    items: RunItem[];
    keep_existing: boolean;
    sync_after: boolean;
    engine: SyncEngine;
  }) => run.mutate(body, { onSuccess: () => setWf({ stage: "run", earlier: [] }) });

  /** One failed item again, as a new run with the first run's choices. */
  const retry = (item: RunItem) => {
    const earlier = entries;
    run.mutate(
      {
        items: [item],
        keep_existing: parsed?.keepExisting ?? false,
        sync_after: parsed?.syncAfter ?? false,
        ...(parsed?.engine ? { engine: parsed.engine } : {}),
      },
      { onSuccess: () => setWf({ stage: "run", earlier }) },
    );
  };

  /** Shows a run already on the server (after a reload, or from another device). */
  const openRun = (jobId: number) => {
    poll.start(jobId);
    setWf({ stage: "run", earlier: [] });
  };

  // ---- Generated and translated ----

  const openMachine = (files: ScanFile[]) =>
    setWf({ stage: "machine", files, keepExisting: false });
  const setMachineKeep = (keepExisting: boolean) =>
    setWf((w) => (w && w.stage === "machine" ? { ...w, keepExisting } : w));

  const machineFiles =
    wf?.stage === "machine"
      ? wf.files
      : choices
        ? choices.filter((c) => !c.skipped).flatMap((c) => c.videos)
        : [];
  const lone = machineFiles.length === 1 ? (machineFiles[0]?.path ?? null) : null;
  const sourcesQ = useQuery({
    queryKey: qk.translateSources(lone ?? ""),
    queryFn: () => subtitlesApi.translateSources(lone ?? ""),
    enabled: lone !== null,
  });

  const translate = useMutation({
    mutationFn: (r: {
      language: string;
      files: string[];
      source: string | undefined;
      keepExisting: boolean;
    }) =>
      subtitlesApi.translate(r.files, r.language, r.source, {
        keep_existing: r.keepExisting,
        ...(folder ? { path: folder } : {}),
      }),
    onSuccess: (_d, r) => {
      refreshActivity();
      toast.success(`Translation queued for ${videos(r.files.length)}. It shows under Activity.`);
    },
  });
  const generate = useMutation({
    mutationFn: (r: { files: string[]; model: string | undefined; keepExisting: boolean }) =>
      subtitlesApi.generate(r.files, r.model, {
        keep_existing: r.keepExisting,
        ...(folder ? { path: folder } : {}),
      }),
    onSuccess: (_d, r) => {
      refreshActivity();
      toast.success(
        `Speech-to-text queued for ${videos(r.files.length)}. It shows under Activity.`,
      );
    },
  });

  return {
    wf,
    close: () => setWf(null),
    // titles and plan
    choices: choices ?? [],
    unconfirmed,
    scope,
    startFind,
    setIdentity,
    toggleSkip,
    setScope,
    toPlan,
    toTitles,
    plan,
    planWanted,
    // run
    download,
    downloading: run.isPending,
    retry,
    openRun,
    runJob: {
      id: poll.jobId,
      status: poll.status ?? "pending",
      currentFile: poll.currentFile,
      error: poll.error,
      loaded: parsed !== null,
    },
    entries,
    // generated and translated
    openMachine,
    machineFiles,
    machineKeep: wf?.stage === "machine" ? wf.keepExisting : false,
    setMachineKeep,
    translateSources: lone !== null && sourcesQ.isSuccess ? sourcesQ.data : null,
    translate: translate.mutate,
    translating: translate.isPending,
    generate: generate.mutate,
    generating: generate.isPending,
  };
}
