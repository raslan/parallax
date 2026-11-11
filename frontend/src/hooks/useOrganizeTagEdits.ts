import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qk } from "@/lib/api";
import { errorDetail, isConflict } from "@/lib/api/client";
import {
  buildReview,
  chunkApplyItems,
  stageOp,
  toApplyItems,
  unstageField,
  type FieldOp,
  type Staged,
} from "@/lib/organizeTagEdits";
import { parentPath } from "@/lib/path";
import type { OrganizeFile, OrganizeTagInfo, TagPlan } from "@/types/organize";

/** Paths per plan request (the server allows 50). */
const PLAN_CHUNK = 50;
/** Full-tag reads in flight at once (one file per request). */
const READ_CONCURRENCY = 4;
const PLAN_STALE_MS = 60_000;

/** What the hook returns: the staged edits and the actions on them, handed to the panel. */
export type TagEdits = ReturnType<typeof useOrganizeTagEdits>;

type Snapshots = Record<string, OrganizeTagInfo | null>;
type Results = Record<string, { status: "written" | "failed"; message: string }>;

const NO_PLANS: Record<string, TagPlan> = {};

async function loadPlans(paths: string[]) {
  const plans: Record<string, TagPlan> = {};
  const free: Record<string, number> = {};
  for (let i = 0; i < paths.length; i += PLAN_CHUNK) {
    const r = await api.planOrganizeTags(paths.slice(i, i + PLAN_CHUNK));
    Object.assign(plans, r.plans);
    Object.assign(free, r.free_bytes);
  }
  return { plans, free };
}

function omit<T>(record: Record<string, T>, paths: string[]): Record<string, T> {
  const gone = new Set(paths);
  return Object.fromEntries(Object.entries(record).filter(([k]) => !gone.has(k)));
}

/**
 * Staging, review and apply for Organize's tag editing. Edits are staged per file for the
 * files passed in (the selection) and written only by `apply`, after the review step. They
 * live for the open folder only: changing `folderPath` discards them. Each staged file keeps
 * the full tags it had when staged, which the review shows as the "before".
 *
 * Staging needs each file's full, uncapped tags (an operation on a value the list cut to
 * 500 characters would corrupt it), read one file per request, four at a time. With
 * `redact` on nothing is staged or written.
 *
 * `files` must be referentially stable (the selection's memoised list). `onWritten` gets the
 * paths that were written, so their cached tags can be read again.
 */
export function useOrganizeTagEdits({
  folderPath,
  files,
  redact,
  onWritten,
  onGone,
}: {
  /** The open folder; staged edits are dropped when it changes. */
  folderPath: string;
  files: OrganizeFile[];
  redact: boolean;
  onWritten: (paths: string[]) => void;
  onGone: () => void;
}) {
  const qc = useQueryClient();
  const [staged, setStaged] = useState<Staged>({});
  const [snapshots, setSnapshots] = useState<Snapshots>({});
  const [results, setResults] = useState<Results>({});
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewPlans, setReviewPlans] = useState<Record<string, TagPlan>>(NO_PLANS);
  const [reviewFree, setReviewFree] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Edits belong to the open folder: opening another one starts from nothing (state is reset
  // while rendering, so no render ever shows the old folder's edits).
  const [seenFolder, setSeenFolder] = useState(folderPath);
  if (seenFolder !== folderPath) {
    setSeenFolder(folderPath);
    setStaged({});
    setSnapshots({});
    setResults({});
    setReviewOpen(false);
  }
  const fullCache = useRef(new Map<string, OrganizeTagInfo | null>());
  useEffect(() => {
    fullCache.current.clear();
  }, [folderPath]);

  // The async functions below read the latest of these after an await.
  const filesRef = useRef(files);
  const stagedRef = useRef(staged);
  const rowsRef = useRef<ReturnType<typeof buildReview>>([]);
  const applyingRef = useRef(false);
  const callbacks = useRef({ onWritten, onGone });
  const reviewPlansRef = useRef(reviewPlans);
  useEffect(() => {
    filesRef.current = files;
    stagedRef.current = staged;
    reviewPlansRef.current = reviewPlans;
    callbacks.current = { onWritten, onGone };
  });

  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const plansQ = useQuery({
    queryKey: qk.organizeTagPlan(paths),
    queryFn: () => loadPlans(paths),
    enabled: paths.length > 0 && !redact,
    staleTime: PLAN_STALE_MS,
    retry: false,
  });
  const plans = plansQ.data?.plans ?? NO_PLANS;

  /** Full tags of `wanted`, one file per request with a few in flight; cached per folder. */
  const readFull = useCallback(
    async (wanted: string[], onProgress?: (done: number, total: number) => void) => {
      const out: Record<string, OrganizeTagInfo | null> = {};
      const todo = wanted.filter((p) => !fullCache.current.has(p));
      for (const p of wanted) if (!todo.includes(p)) out[p] = fullCache.current.get(p) ?? null;
      let next = 0;
      let done = 0;
      onProgress?.(0, wanted.length);
      const worker = async () => {
        while (next < todo.length) {
          const p = todo[next++]!;
          let info: OrganizeTagInfo | null = null;
          try {
            info = (await api.getOrganizeTags([p], true)).tags[p] ?? null;
          } catch {
            // An unreadable file just has no tags to show; the plan says whether it can be edited.
          }
          fullCache.current.set(p, info);
          out[p] = info;
          onProgress?.(++done, wanted.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, todo.length) }, worker));
      return out;
    },
    [],
  );

  const commitStaged = useCallback((next: Staged, fresh?: Snapshots) => {
    stagedRef.current = next;
    setStaged(next);
    setSnapshots((prev) => {
      const out: Snapshots = {};
      for (const p of Object.keys(next)) {
        // A file's snapshot (the review's "before") is taken when its first edit is staged.
        const snap = prev[p] !== undefined ? prev[p] : fresh?.[p];
        out[p] = snap ?? null;
      }
      return out;
    });
  }, []);

  const stage = useCallback(
    async (field: string, op: FieldOp) => {
      if (redact) return { skipped: [] as string[], error: null as string | null };
      if (applyingRef.current) {
        return { skipped: [], error: "Tags are being written. Stage again when it finishes." };
      }
      const selected = filesRef.current;
      const selectedPaths = selected.map((f) => f.path);
      let infos: Record<string, OrganizeTagInfo | null> = {};
      try {
        infos = await readFull(selectedPaths, (done, total) => setReading({ done, total }));
      } finally {
        setReading(null);
      }
      let planMap: Record<string, TagPlan>;
      try {
        planMap = (
          await qc.fetchQuery({
            queryKey: qk.organizeTagPlan(selectedPaths),
            queryFn: () => loadPlans(selectedPaths),
            staleTime: PLAN_STALE_MS,
          })
        ).plans;
      } catch (e) {
        if (isConflict(e)) callbacks.current.onGone();
        return {
          skipped: [],
          error: errorDetail(e, "Could not check what these files can hold."),
        };
      }
      const out = stageOp(
        stagedRef.current,
        selected.map((f) => ({ path: f.path, info: infos[f.path] })),
        field,
        op,
        planMap,
      );
      if (!out.error) {
        commitStaged(out.staged, infos);
        setResults({});
      }
      return { skipped: out.skipped, error: out.error };
    },
    [redact, readFull, qc, commitStaged],
  );

  const unstage = useCallback(
    (field: string) => {
      commitStaged(
        unstageField(
          stagedRef.current,
          filesRef.current.map((f) => f.path),
          field,
        ),
      );
      setResults({});
    },
    [commitStaged],
  );

  const drop = useCallback(
    (gone: string[]) => {
      commitStaged(omit(stagedRef.current, gone));
      setResults((prev) => omit(prev, gone));
      for (const p of gone) fullCache.current.delete(p);
    },
    [commitStaged],
  );

  const clearAll = useCallback(() => {
    commitStaged({});
    setResults({});
    setReviewOpen(false);
    fullCache.current.clear();
  }, [commitStaged]);

  const openReview = useCallback(async () => {
    if (redact) return;
    setReviewOpen(true);
    setReviewLoading(true);
    const stagedPaths = Object.keys(stagedRef.current);
    try {
      // Only what each file can take and how it is written; the "before" values are the
      // ones the user saw when staging.
      const loaded = await loadPlans(stagedPaths);
      setReviewPlans(loaded.plans);
      setReviewFree(loaded.free);
    } catch (e) {
      // Without the plans there is nothing safe to review or apply.
      setReviewOpen(false);
      if (isConflict(e)) callbacks.current.onGone();
      else toast.error(errorDetail(e, "Could not check the files for the review."));
    } finally {
      setReviewLoading(false);
    }
  }, [redact]);

  const closeReview = useCallback(() => setReviewOpen(false), []);

  const rows = useMemo(
    () => (reviewOpen ? buildReview(staged, snapshots, reviewPlans) : []),
    [reviewOpen, staged, snapshots, reviewPlans],
  );
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const review = useMemo(() => {
    const sendable = toApplyItems(rows).map((i) => i.path);
    // Rewrites run one after another, each on its own copy, so the folder needs room for the
    // biggest one, not for all of them at once.
    const needed = Math.max(0, ...sendable.map((p) => reviewPlans[p]?.bytes_needed ?? 0));
    const frees = sendable
      .filter((p) => (reviewPlans[p]?.bytes_needed ?? 0) > 0)
      .map((p) => reviewFree[parentPath(p)])
      .filter((n): n is number => n !== undefined);
    return {
      open: reviewOpen,
      loading: reviewLoading,
      rows,
      /** Staged files whose values equal what they already have: nothing to write. */
      skippedCount: Math.max(0, Object.keys(staged).length - rows.length),
      neededBytes: needed,
      /** Free space of the tightest folder a rewrite goes to; null when nothing is rewritten. */
      freeBytes: frees.length > 0 ? Math.min(...frees) : null,
    };
  }, [rows, reviewOpen, reviewLoading, reviewPlans, reviewFree, staged]);

  const apply = useCallback(async () => {
    if (redact || applyingRef.current) return;
    const items = toApplyItems(rowsRef.current);
    if (items.length === 0) return;
    applyingRef.current = true;
    setApplying(true);
    setResults({});
    setProgress({ done: 0, total: items.length });
    const out: Results = {};
    let gone = false;
    const plansNow = reviewPlansRef.current;
    const chunks = chunkApplyItems(items, (p) => plansNow[p]?.bytes_needed ?? 0);
    let sent = 0;
    for (const chunk of chunks) {
      if (gone) break;
      try {
        const res = await api.applyOrganizeTags(chunk);
        for (const item of chunk) {
          out[item.path] = res.results[item.path] ?? {
            status: "failed",
            message: "The server gave no answer for this file.",
          };
        }
      } catch (e) {
        if (isConflict(e)) {
          gone = true;
          callbacks.current.onGone();
        } else {
          // A timeout or a dropped connection says nothing about the server: it may well have
          // written some of these. Say so, and read them again.
          const message =
            "The request failed, so Parallax can't tell whether these files were written. " +
            "Check their tags before trying again.";
          for (const item of chunk) out[item.path] = { status: "failed", message };
          callbacks.current.onWritten(chunk.map((item) => item.path));
        }
      }
      sent += chunk.length;
      setProgress({ done: sent, total: items.length });
    }
    const written = Object.keys(out).filter((p) => out[p]!.status === "written");
    const failed = Object.keys(out).length - written.length;
    if (written.length > 0) {
      commitStaged(omit(stagedRef.current, written));
      for (const p of written) fullCache.current.delete(p);
      void qc.invalidateQueries({ queryKey: qk.organizeTagPlan() });
      callbacks.current.onWritten(written);
      toast.success(`Tags written to ${written.length} ${written.length === 1 ? "file" : "files"}`);
    }
    if (failed > 0) {
      toast.error(`${failed} ${failed === 1 ? "file" : "files"} could not be written`, {
        description: "They are still staged. The review lists what went wrong.",
      });
    }
    setResults(out);
    setProgress(null);
    setApplying(false);
    applyingRef.current = false;
  }, [redact, qc, commitStaged]);

  return {
    staged,
    snapshots,
    stagedCount: Object.keys(staged).length,
    plans,
    planLoading: plansQ.isFetching,
    stage,
    unstage,
    /** Full reads in progress while staging, else null. */
    reading,
    review,
    openReview,
    closeReview,
    apply,
    applying,
    progress,
    /** Per file, what the last apply said (failed ones also stay staged). */
    results,
    drop,
    clearAll,
  };
}
