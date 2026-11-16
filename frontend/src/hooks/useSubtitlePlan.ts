import { useCallback, useEffect, useMemo, useState } from "react";
import { subtitlesApi } from "@/lib/api";
import { errorDetail, getErrorMessage } from "@/lib/api/client";
import { kindsFor } from "@/lib/subtitleCoverage";
import { isClean } from "@/lib/subtitleRunDock";
import type {
  Candidate,
  Identity,
  LengthResult,
  PlanGroup,
  PlanRowState,
  PlanScope,
  PlanVerdict,
  SubtitleProvider,
} from "@/types/subtitle";

/** What the server says when a source does not apply to the title (not a failure). */
const NOT_APPLICABLE = new Set(["Films only", "TV only"]);

/** Requests to the subtitle sites at once; the server adds its own delay between them. */
const MAX_IN_FLIGHT = 2;

/** What a row is before anything was searched: from the plan's inputs and the disk. */
interface Base {
  key: string;
  video: string;
  filename: string;
  title: string;
  season: number | null;
  episode: number | null;
  language: string;
  identity: Identity;
  hasReal: boolean;
  /** Searched from the start (scope "all", or nothing real in that language yet). */
  searched: boolean;
  machineKind: "generated" | "translated" | null;
}

/** What happened to a row since: its search, the user's choices, its length check. */
interface Overlay {
  found?: { candidates: Candidate[]; errors: { provider: string; message: string }[] };
  failed?: boolean;
  forced?: boolean;
  verdict?: PlanVerdict;
  length?: LengthResult;
}

type Task =
  { kind: "search"; key: string } | { kind: "preview"; key: string; candidate: Candidate };

/**
 * A small ordered queue with a cap on requests in flight. `reset` starts a new generation:
 * answers to an older one are ignored, so a changed plan never mixes with the last one.
 */
class PlanQueue {
  private queue: Task[] = [];
  private inFlight = 0;
  private gen = 0;
  private run: ((task: Task, current: () => boolean) => Promise<void>) | null = null;
  private paused = false;
  private skipChecks = false;

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.pump();
  }

  stopChecks() {
    this.skipChecks = true;
  }

  reset(tasks: Task[], run: (task: Task, current: () => boolean) => Promise<void>) {
    this.gen++;
    this.queue = tasks;
    this.inFlight = 0;
    this.paused = false;
    this.skipChecks = false;
    this.run = run;
  }

  stop() {
    this.gen++;
    this.queue = [];
    this.run = null;
  }

  push(task: Task, front = false) {
    if (front) this.queue.unshift(task);
    else this.queue.push(task);
  }

  pump() {
    const run = this.run;
    if (!run) return;
    while (!this.paused && this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task || (task.kind === "preview" && this.skipChecks)) continue;
      const gen = this.gen;
      const current = () => gen === this.gen;
      this.inFlight++;
      void run(task, current).finally(() => {
        if (!current()) return;
        this.inFlight--;
        this.pump();
      });
    }
  }
}

const rowKey = (video: string, language: string) => `${video}\u0000${language}`;

function buildBases(groups: PlanGroup[], wanted: string[], scope: PlanScope): Base[] {
  const out: Base[] = [];
  for (const g of groups) {
    for (const f of g.files) {
      for (const language of wanted) {
        const k = kindsFor(f, language);
        out.push({
          key: rowKey(f.path, language),
          video: f.path,
          filename: f.filename,
          title: g.key,
          season: f.season,
          episode: f.episode,
          language,
          identity: g.identity,
          hasReal: k.real,
          searched: scope === "all" || !k.real,
          machineKind: k.generated ? "generated" : k.translated ? "translated" : null,
        });
      }
    }
  }
  return out;
}

const flaggedLength = (l: LengthResult | undefined) =>
  !!l && "length" in l && (l.length === "short" || l.length === "long");

function toRow(b: Base, ov: Overlay = {}): PlanRowState {
  const candidates = ov.found?.candidates ?? [];
  const candidate = candidates[0];
  let status: PlanRowState["status"];
  if (!b.searched && !ov.forced) status = "has_real";
  else if (!ov.found) status = "checking";
  else if (!candidate) status = "none";
  else if (flaggedLength(ov.length)) status = "flagged";
  else if (b.machineKind) status = "replaces_machine";
  else status = "ready";
  return {
    key: b.key,
    video: b.video,
    filename: b.filename,
    title: b.title,
    season: b.season,
    episode: b.episode,
    language: b.language,
    status,
    candidate,
    candidates,
    verdict: ov.verdict,
    lengthResult: ov.length,
    machineKind: b.machineKind,
    hasReal: b.hasReal,
    errors: ov.found?.errors ?? [],
  };
}

/**
 * The plan's search, driven from the browser: one read-only `POST /subtitles/search` per
 * video and language it needs (scope `missing` skips a language that already has a real
 * subtitle; `all` searches every selected video), at most two in flight, in plan order,
 * pausable. Then the length check of each row's top candidate (`POST /subtitles/preview`,
 * nothing written beside the video), after the searches, with the same cap; Skip checks
 * stops further checks and leaves those rows unchecked. A row is `flagged` when its top
 * candidate looks short or long. Nothing here is saved: a changed input starts over.
 */
export function useSubtitlePlan({
  groups,
  wanted,
  providers,
  scope,
}: {
  groups: PlanGroup[];
  wanted: string[];
  providers: SubtitleProvider[];
  scope: PlanScope;
}) {
  const input = useMemo(
    () => ({ bases: buildBases(groups, wanted, scope), providers }),
    [groups, wanted, scope, providers],
  );
  const [queue] = useState(() => new PlanQueue());
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [paused, setPaused] = useState(false);
  const [checksSkipped, setChecksSkipped] = useState(false);

  // A new plan starts from nothing (adjusted while rendering, not in an effect).
  const [planned, setPlanned] = useState(input);
  if (planned !== input) {
    setPlanned(input);
    setOverlay({});
    setPaused(false);
    setChecksSkipped(false);
  }

  const patch = useCallback(
    (key: string, p: Overlay) => setOverlay((o) => ({ ...o, [key]: { ...o[key], ...p } })),
    [],
  );

  useEffect(() => {
    // Drives an external system (the subtitle sites) from the plan's inputs.
    const byKey = new Map(input.bases.map((b) => [b.key, b]));
    const run = async (task: Task, current: () => boolean) => {
      const b = byKey.get(task.key);
      if (!b) return;
      if (task.kind === "search") {
        try {
          const res = await subtitlesApi.search({
            video_path: b.video,
            identity: b.identity,
            languages: [b.language],
            providers: input.providers,
            ...(b.season != null ? { season: b.season } : {}),
            ...(b.episode != null ? { episode: b.episode } : {}),
          });
          if (!current()) return;
          patch(b.key, { found: res, failed: false, length: undefined });
          const top = res.candidates[0];
          if (top) queue.push({ kind: "preview", key: b.key, candidate: top });
        } catch (e) {
          if (!current()) return;
          const message = errorDetail(e, getErrorMessage(e, "Search failed"));
          patch(b.key, {
            found: { candidates: [], errors: [{ provider: "search", message }] },
            failed: true,
          });
        }
        return;
      }
      try {
        const p = await subtitlesApi.preview({
          video_path: b.video,
          provider: task.candidate.provider,
          subtitle_id: task.candidate.subtitle_id,
          language: b.language,
        });
        if (current()) {
          const length: LengthResult = {
            length: p.length,
            last: p.last,
            videoDuration: p.video_duration,
          };
          // A row flagged after it was approved must be approved again, by the user.
          patch(b.key, flaggedLength(length) ? { length, verdict: undefined } : { length });
        }
      } catch (e) {
        if (current())
          patch(b.key, {
            length: { error: errorDetail(e, getErrorMessage(e, "Could not check the length")) },
          });
      }
    };
    queue.reset(
      input.bases.filter((b) => b.searched).map((b) => ({ kind: "search", key: b.key })),
      run,
    );
    queue.pump();
    return () => queue.stop();
  }, [input, queue, patch]);

  const rows = useMemo(
    () => input.bases.map((b) => toRow(b, overlay[b.key])),
    [input.bases, overlay],
  );

  const searchRows = rows.filter((r) => r.status !== "has_real");
  const progress = {
    done: searchRows.filter((r) => r.status !== "checking").length,
    total: searchRows.length,
  };
  const withCandidate = rows.filter((r) => r.candidate);
  const checked = withCandidate.filter((r) => r.lengthResult).length;
  const checks = { done: checked, total: checksSkipped ? checked : withCandidate.length };

  // Failures (a source broke) and notes (a source does not apply, e.g. films only) are
  // counted apart: only failures keep the red banner and the Retry up.
  const { errors, notes } = useMemo(() => {
    const failed = new Map<string, { provider: string; message: string; count: number }>();
    const applies = new Map<string, { provider: string; message: string; count: number }>();
    for (const r of rows) {
      for (const e of r.errors) {
        const into = NOT_APPLICABLE.has(e.message) ? applies : failed;
        const k = `${e.provider}\u0000${e.message}`;
        const c = into.get(k) ?? { ...e, count: 0 };
        c.count++;
        into.set(k, c);
      }
    }
    return { errors: [...failed.values()], notes: [...applies.values()] };
  }, [rows]);

  const pause = useCallback(() => {
    queue.setPaused(true);
    setPaused(true);
  }, [queue]);
  const resume = useCallback(() => {
    queue.setPaused(false);
    setPaused(false);
  }, [queue]);
  const skipChecks = useCallback(() => {
    queue.stopChecks();
    setChecksSkipped(true);
  }, [queue]);

  /** Searches a row that already has a real subtitle, next in line. */
  const findAnother = useCallback(
    (key: string) => {
      patch(key, { forced: true, found: undefined, length: undefined, verdict: undefined });
      queue.push({ kind: "search", key }, true);
      queue.pump();
    },
    [patch, queue],
  );

  /** Searches again every row whose search failed or a source broke on (not "films only"). */
  const retry = useCallback(() => {
    for (const r of rows) {
      if (r.status !== "none" || !r.errors.some((e) => !NOT_APPLICABLE.has(e.message))) continue;
      patch(r.key, { found: undefined, failed: false });
      queue.push({ kind: "search", key: r.key });
    }
    queue.pump();
  }, [rows, patch, queue]);

  const setVerdict = useCallback(
    (key: string, verdict: PlanVerdict | undefined) => patch(key, { verdict }),
    [patch],
  );
  /**
   * A candidate picked in Compare becomes the row's candidate (listed first) with the verdict
   * the user gave it. Its length is the one Compare measured (`length`); without one, and when
   * it is not the candidate the plan checked, the row says it was not checked.
   */
  const chooseCandidate = useCallback(
    (key: string, candidate: Candidate, verdict: PlanVerdict, length?: LengthResult) => {
      const r = rows.find((x) => x.key === key);
      if (!r) return;
      const same = (c: Candidate) =>
        c.provider === candidate.provider && c.subtitle_id === candidate.subtitle_id;
      const top = r.candidate;
      patch(key, {
        found: {
          candidates: [candidate, ...r.candidates.filter((c) => !same(c))],
          errors: r.errors,
        },
        ...(length ? { length } : top && same(top) ? {} : { length: { error: "Not checked" } }),
        verdict,
      });
    },
    [rows, patch],
  );
  const toggleUse = useCallback(
    (key: string) => {
      const r = rows.find((x) => x.key === key);
      if (!r) return;
      const on = r.verdict === "use" || r.verdict === "use_and_sync";
      patch(key, { verdict: on ? undefined : "use" });
    },
    [rows, patch],
  );
  // `exclude`: title keys whose identity the user has not confirmed. Their rows are never
  // "clean"; they can still be approved one by one.
  const approveAllClean = useCallback(
    (exclude?: ReadonlySet<string>) => {
      setOverlay((o) => {
        const next = { ...o };
        for (const r of rows) {
          if (exclude?.has(r.title)) continue;
          if (isClean(r, checksSkipped) && !r.verdict)
            next[r.key] = { ...next[r.key], verdict: "use" };
        }
        return next;
      });
    },
    [rows, checksSkipped],
  );

  return {
    rows,
    notes,
    progress,
    checks,
    paused,
    checksSkipped,
    errors,
    pause,
    resume,
    skipChecks,
    findAnother,
    retry,
    setVerdict,
    chooseCandidate,
    toggleUse,
    approveAllClean,
  };
}
