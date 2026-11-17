import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qk, subtitlesApi } from "@/lib/api";
import { errorDetail, getErrorMessage } from "@/lib/api/client";
import { matchRowsFromResults, parseSearchSettings, statusFor } from "@/lib/subtitleSearchJob";
import { isClean } from "@/lib/subtitleRunDock";
import type {
  Candidate,
  LengthResult,
  MatchRowState,
  MatchVerdict,
  ScanFile,
} from "@/types/subtitle";

/** What the server says when a source does not apply to the title (not a failure). */
const NOT_APPLICABLE = new Set(["Films only", "TV only"]);
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 2000;
/** Failed reads of the job in a row after which the view stops asking. */
const MAX_POLL_FAILURES = 6;

/** What the user did on this page since: their choices, and rows searched again by hand. */
interface Overlay {
  /** A row searched again by hand (Find another), or a candidate picked in Compare. */
  found?: { candidates: Candidate[]; errors: { provider: string; message: string }[] };
  searching?: boolean;
  /** The search for this row failed outright (not "found nothing"). */
  failed?: boolean;
  verdict?: MatchVerdict;
  length?: LengthResult;
}

const NO_SETTINGS = null;
const NO_OVERLAY: Record<string, Overlay> = {};

/**
 * The Matches view of a search job. The search runs on the server as an ordinary job; this
 * only follows it (the job is read every couple of seconds until it ends) and turns its stored
 * results into rows. Ticks, verdicts, a candidate picked in Compare and a row searched again by
 * hand (Find another, one read-only `POST /subtitles/search`) are page state laid over the
 * rows: they never reach the server, and a new poll does not undo them. `jobId` null follows
 * nothing.
 */
export function useSubtitleMatches({
  jobId,
  files,
  pollMs = POLL_MS,
}: {
  jobId: number | null;
  files: ScanFile[];
  pollMs?: number;
}) {
  const jobQ = useQuery({
    queryKey: qk.job(jobId ?? -1),
    queryFn: () => api.getJob(jobId as number),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      if (query.state.status === "error") {
        // A failed read (a restarting container, a dropped connection) must not freeze the
        // view on "Searching": try again, more slowly, and give up only after several in a row.
        return query.state.errorUpdateCount < MAX_POLL_FAILURES ? pollMs * 5 : false;
      }
      return pollMs;
    },
  });
  const job = jobId != null && jobQ.data?.id === jobId ? jobQ.data : null;
  const settings = useMemo(() => parseSearchSettings(job) ?? NO_SETTINGS, [job]);
  const jobStatus = job?.status ?? null;
  const ended = jobStatus !== null && TERMINAL.has(jobStatus);

  // The page's choices belong to one job: another search starts from nothing (adjusted while
  // rendering, not in an effect), and an answer that arrives for an earlier job lands nowhere.
  const [state, setState] = useState<{ job: number | null; rows: Record<string, Overlay> }>({
    job: jobId,
    rows: {},
  });
  if (state.job !== jobId) setState({ job: jobId, rows: {} });
  const overlay = state.job === jobId ? state.rows : NO_OVERLAY;
  const patch = useCallback(
    (key: string, p: Overlay) =>
      setState((s) =>
        s.job === jobId ? { ...s, rows: { ...s.rows, [key]: { ...s.rows[key], ...p } } } : s,
      ),
    [jobId],
  );

  const baseRows = useMemo(
    () => (settings ? matchRowsFromResults(settings, files, ended) : []),
    [settings, files, ended],
  );
  const rows = useMemo(
    () =>
      baseRows.map((r): MatchRowState => {
        const ov = overlay[r.key];
        if (!ov) return r;
        const candidates = ov.found?.candidates ?? r.candidates;
        const lengthResult = ov.length ?? (ov.found ? undefined : r.lengthResult);
        const state = ov.searching
          ? "pending"
          : ov.failed
            ? "failed"
            : ov.found || r.status !== "has_real"
              ? "searched"
              : "has_real";
        // A row that was not searched and is not being searched keeps its status; any other is
        // worked out again from what it holds now.
        const status =
          !ov.searching && !ov.found && !ov.length
            ? r.status
            : statusFor(state, candidates, lengthResult, r.machineKind);
        return {
          ...r,
          status,
          candidate: candidates[0],
          candidates,
          lengthResult,
          verdict: ov.verdict,
          errors: ov.found?.errors ?? r.errors,
        };
      }),
    [baseRows, overlay],
  );

  const searchRows = rows.filter((r) => r.status !== "has_real");
  const progress = {
    // A row waiting only for its length check has been searched (it has its candidates).
    done: searchRows.filter((r) => r.status !== "checking" || r.candidate).length,
    total: searchRows.length,
  };
  const checksSkipped = settings ? !settings.check_lengths : false;
  const withCandidate = rows.filter((r) => r.candidate && r.status !== "failed");
  const checked = withCandidate.filter((r) => r.lengthResult).length;
  const checks = {
    done: checked,
    total: checksSkipped || !settings ? checked : withCandidate.length,
  };

  // Failures (a source broke) and notes (a source does not apply, e.g. films only) are
  // counted apart: only failures keep the red banner up.
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

  /** Searches one row again, read-only, for the title's identity and the job's sources. */
  const findAnother = useCallback(
    (key: string) => {
      const r = baseRows.find((x) => x.key === key);
      const title = settings?.titles.find((t) => t.key === r?.title);
      if (!r || !settings || !title) return;
      patch(key, {
        searching: true,
        failed: false,
        found: undefined,
        length: undefined,
        verdict: undefined,
      });
      void subtitlesApi
        .search({
          video_path: r.video,
          identity: title.identity,
          languages: [r.language],
          providers: settings.providers,
          ...(r.season != null ? { season: r.season } : {}),
          ...(r.episode != null ? { episode: r.episode } : {}),
        })
        .then(
          (res) => patch(key, { searching: false, found: res }),
          (e: unknown) => {
            const message = errorDetail(e, getErrorMessage(e, "Search failed"));
            patch(key, {
              searching: false,
              failed: true,
              found: { candidates: [], errors: [{ provider: "search", message }] },
            });
          },
        );
    },
    [baseRows, settings, patch],
  );

  /** What Compare searches for to list a row's whole candidate list. */
  const searchFor = useCallback(
    (row: MatchRowState) => {
      const title = settings?.titles.find((t) => t.key === row.title);
      return settings && title ? { identity: title.identity, providers: settings.providers } : null;
    },
    [settings],
  );

  const setVerdict = useCallback(
    (key: string, verdict: MatchVerdict | undefined) => patch(key, { verdict }),
    [patch],
  );
  /**
   * A candidate picked in Compare becomes the row's candidate (listed first) with the verdict
   * the user gave it. Its length is the one Compare measured (`length`); without one, and when
   * it is not the candidate the search checked, the row says it was not checked.
   */
  const chooseCandidate = useCallback(
    (key: string, candidate: Candidate, verdict: MatchVerdict, length?: LengthResult) => {
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
        ...(length
          ? { length }
          : top && same(top)
            ? { length: r.lengthResult }
            : { length: { error: "Not checked" } }),
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
      setState((s) => {
        if (s.job !== jobId) return s;
        const next = { ...s.rows };
        for (const r of rows) {
          if (exclude?.has(r.title)) continue;
          if (isClean(r, checksSkipped) && !r.verdict)
            next[r.key] = { ...next[r.key], verdict: "use" };
        }
        return { ...s, rows: next };
      });
    },
    [rows, checksSkipped, jobId],
  );

  return {
    jobId,
    /** The job's settings were read: the rows, titles and languages below are real. */
    loaded: settings !== null,
    jobStatus,
    jobError: job?.error ?? null,
    currentFile: job?.current_file ?? null,
    /** Pending or running: the search is still working. */
    running: jobStatus !== null && !TERMINAL.has(jobStatus),
    settings,
    wanted: settings?.languages ?? [],
    titles: (settings?.titles ?? []).map((t) => ({
      key: t.key,
      name: t.identity.year ? `${t.identity.title} (${t.identity.year})` : t.identity.title,
      certain: t.certain,
    })),
    rows,
    notes,
    progress,
    checks,
    checksSkipped,
    errors,
    findAnother,
    searchFor,
    setVerdict,
    chooseCandidate,
    toggleUse,
    approveAllClean,
  };
}
