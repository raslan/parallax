import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qk } from "@/lib/api";
import { errorDetail, isConflict } from "@/lib/api/client";
import {
  buildReview,
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
/** Files per apply request: rewrites are heavy, so the progress stays honest and a stop loses little. */
const APPLY_CHUNK = 10;
/** Full-tag reads in flight at once (one file per request). */
const READ_CONCURRENCY = 4;
const PLAN_STALE_MS = 60_000;

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
 * files passed in (the selection), kept in page state while the selection or the open
 * folder changes, and written only by `apply`, after the review step. Each staged file keeps
 * a full-tags snapshot (what the user saw); opening the review re-reads every staged file,
 * and one whose staged fields moved since is flagged and left out of apply.
 *
 * Staging needs each file's full, uncapped tags (an operation on a value the list cut to
 * 500 characters would corrupt it), read one file per request, four at a time. With
 * `redact` on nothing is staged or written.
 *
 * `files` must be referentially stable (the selection's memoised list). `onWritten` gets the
 * paths that were written, so their cached tags can be read again.
 */
export function useOrganizeTagEdits({
  files,
  redact,
  onWritten,
  onGone,
}: {
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
  const [current, setCurrent] = useState<Record<string, OrganizeTagInfo | null | undefined>>({});
  const [reviewPlans, setReviewPlans] = useState<Record<string, TagPlan>>(NO_PLANS);
  const [reviewFree, setReviewFree] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // The async functions below read the latest of these after an await.
  const filesRef = useRef(files);
  const stagedRef = useRef(staged);
  const rowsRef = useRef<ReturnType<typeof buildReview>>([]);
  const applyingRef = useRef(false);
  const callbacks = useRef({ onWritten, onGone });
  useEffect(() => {
    filesRef.current = files;
    stagedRef.current = staged;
    callbacks.current = { onWritten, onGone };
  });
  const fullCache = useRef(new Map<string, OrganizeTagInfo | null>());

  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const plansQ = useQuery({
    queryKey: qk.organizeTagPlan(paths),
    queryFn: () => loadPlans(paths),
    enabled: paths.length > 0 && !redact,
    staleTime: PLAN_STALE_MS,
    retry: false,
  });
  const plans = plansQ.data?.plans ?? NO_PLANS;

  /** Full tags of `wanted`, one file per request with a few in flight; cached unless `fresh`. */
  const readFull = useCallback(
    async (wanted: string[], fresh = false, onProgress?: (done: number, total: number) => void) => {
      const out: Record<string, OrganizeTagInfo | null> = {};
      const todo = wanted.filter((p) => fresh || !fullCache.current.has(p));
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
        const snap = fresh?.[p] !== undefined ? fresh[p] : prev[p];
        out[p] = snap ?? null;
      }
      return out;
    });
  }, []);

  const stage = useCallback(
    async (field: string, op: FieldOp) => {
      if (redact) return { skipped: [] as string[], error: null as string | null };
      const selected = filesRef.current;
      const selectedPaths = selected.map((f) => f.path);
      let infos: Record<string, OrganizeTagInfo | null> = {};
      try {
        infos = await readFull(selectedPaths, false, (done, total) => setReading({ done, total }));
      } finally {
        setReading(null);
      }
      const { plans: planMap } = await qc.fetchQuery({
        queryKey: qk.organizeTagPlan(selectedPaths),
        queryFn: () => loadPlans(selectedPaths),
        staleTime: PLAN_STALE_MS,
      });
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
      const [infos, loaded] = await Promise.all([
        readFull(stagedPaths, true),
        loadPlans(stagedPaths),
      ]);
      setCurrent(infos);
      setReviewPlans(loaded.plans);
      setReviewFree(loaded.free);
    } finally {
      setReviewLoading(false);
    }
  }, [redact, readFull]);

  const closeReview = useCallback(() => setReviewOpen(false), []);

  const rows = useMemo(
    () => (reviewOpen ? buildReview(staged, snapshots, current, reviewPlans) : []),
    [reviewOpen, staged, snapshots, current, reviewPlans],
  );
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const review = useMemo(() => {
    const sendable = toApplyItems(rows).map((i) => i.path);
    const needed = sendable.reduce((sum, p) => sum + (reviewPlans[p]?.bytes_needed ?? 0), 0);
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
    for (let i = 0; i < items.length && !gone; i += APPLY_CHUNK) {
      const chunk = items.slice(i, i + APPLY_CHUNK);
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
          const message = errorDetail(
            e,
            "The request failed. Nothing was written for these files.",
          );
          for (const item of chunk) out[item.path] = { status: "failed", message };
        }
      }
      setProgress({ done: Math.min(i + APPLY_CHUNK, items.length), total: items.length });
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
