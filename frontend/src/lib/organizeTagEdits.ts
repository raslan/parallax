/**
 * Planning for Organize's tag editing: staging edits for the selected files, what the
 * review step shows (before → after per file), and what actually gets sent. Pure.
 *
 * Every staged value is concrete per file: an operation (prepend, append, find/replace)
 * is resolved against each file's own value when it is staged, so the review shows exact
 * results. The server stays the authority and re-validates everything.
 */

import { applyFindReplace, type FindRule } from "@/lib/findReplace";
import type { OrganizeTagInfo, TagApplyItem, TagPlan, TagWriteHow } from "@/types/organize";

const RAW_PREFIX = "raw:";

/** Path → field → the value to write (`null` clears). Fields are canonical names or `raw:<name>`. */
export type Staged = Record<string, Record<string, string | null>>;

export type FieldOp =
  | { op: "set"; value: string }
  | { op: "clear" }
  | { op: "prepend"; text: string }
  | { op: "append"; text: string }
  | { op: "replace"; rule: FindRule };

export interface StageFile {
  path: string;
  /** The file's full tags; `null` when it has none to read, `undefined` while loading. */
  info: OrganizeTagInfo | null | undefined;
}

export interface StageResult {
  staged: Staged;
  /** Files nothing was staged for because they could not take it (not loaded, a value too long to edit safely, a field their format lacks). */
  skipped: string[];
  /** A regular expression that does not compile; nothing is staged then. */
  error: string | null;
}

interface ReviewChange {
  field: string;
  before: string | undefined;
  after: string | null;
}

export interface ReviewRow {
  path: string;
  changes: ReviewChange[];
  /** Staged fields this file's format cannot hold; they are not sent. */
  blocked: string[];
  how: TagWriteHow | null;
  /** Why the file cannot be written at all. */
  reason: string | null;
  note: string | null;
}

/** A field as the user reads it: "Album artist", the tag's own name for a `raw:` one. */
export function fieldLabel(field: string): string {
  if (field.startsWith(RAW_PREFIX)) return field.slice(RAW_PREFIX.length);
  if (field === "gps") return "Location";
  const text = field.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Names a tool may store a standard field under (what the server refuses as a custom tag). */
const STANDARD_NAMES: Record<string, string> = {
  title: "title",
  description: "description",
  desc: "description",
  synopsis: "synopsis",
  comment: "comment",
  artist: "artist",
  album: "album",
  album_artist: "album_artist",
  albumartist: "album_artist",
  genre: "genre",
  date: "date",
  track: "track",
};

/** The standard field a tag name belongs to ("Desc" → description), or null for a custom name. */
export function standardFieldFor(name: string): string | null {
  return STANDARD_NAMES[name.trim().toLowerCase()] ?? null;
}

const GPS_RAW = /^(GPS:|XMP-exif:GPS)/;
const GPS_PRESENT = "Has a location";
/** The server refuses a longer value (one argument of a tool's command line). */
const MAX_VALUE_CHARS = 30_000;
/** Files per apply request, and the rewrite bytes after which a request is closed. */
const APPLY_CHUNK_FILES = 10;
const APPLY_CHUNK_BYTES = 1024 ** 3;

/**
 * Splits what to send into requests: at most ten files, and a request is closed once its
 * rewrites add up to about a gibibyte, so one request never holds minutes of copying (a
 * proxy timeout would report a failure for files that were in fact written). A file over
 * the limit still goes, alone.
 */
export function chunkApplyItems(
  items: TagApplyItem[],
  bytesOf: (path: string) => number,
): TagApplyItem[][] {
  const chunks: TagApplyItem[][] = [];
  let current: TagApplyItem[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = bytesOf(item.path);
    if (
      current.length > 0 &&
      (current.length >= APPLY_CHUNK_FILES || bytes + size > APPLY_CHUNK_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** A batch read cuts a long value to 500 characters and appends this. */
const CAP_LENGTH = 501;

/** One field's value as the file has it now; `undefined` when absent. */
export function currentValue(
  info: OrganizeTagInfo | null | undefined,
  field: string,
): string | undefined {
  if (!info) return undefined;
  if (field === "gps")
    return Object.keys(info.raw).some((k) => GPS_RAW.test(k)) ? GPS_PRESENT : undefined;
  if (field.startsWith(RAW_PREFIX)) {
    const name = field.slice(RAW_PREFIX.length);
    if (name in info.raw) return info.raw[name];
    const folded = name.toLowerCase();
    const hit = Object.keys(info.raw).find((k) => k.toLowerCase() === folded);
    return hit === undefined ? undefined : info.raw[hit];
  }
  return info.fields[field];
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim() === (b ?? "").trim();

const isCut = (value: string | undefined, info: OrganizeTagInfo | null) =>
  !!info?.truncated && value !== undefined && value.length === CAP_LENGTH && value.endsWith("…");

/** Whether this file's plan lets `field` be written (an unknown plan lets everything through). */
export function planOffers(plan: TagPlan | undefined, field: string): boolean {
  if (!plan) return true;
  if (!plan.writable) return false;
  return plan.fields.includes(field) || (field.startsWith(RAW_PREFIX) && plan.can_add_raw);
}

function nextValue(op: FieldOp, current: string | undefined): string | null | undefined {
  switch (op.op) {
    case "set":
      return op.value.trim() === "" ? null : op.value;
    case "clear":
      return null;
    case "prepend":
      return op.text === "" ? undefined : op.text + (current ?? "");
    case "append":
      return op.text === "" ? undefined : (current ?? "") + op.text;
    case "replace":
      return current === undefined ? undefined : applyFindReplace(current, op.rule).text;
  }
}

const readsOldValue = (op: FieldOp) =>
  op.op === "prepend" || op.op === "append" || op.op === "replace";

function copyStaged(staged: Staged): Staged {
  const out: Staged = {};
  for (const path of Object.keys(staged)) out[path] = { ...staged[path] };
  return out;
}

/** Stage `op` on `field` for each file. Never mutates `staged`. */
export function stageOp(
  staged: Staged,
  files: StageFile[],
  field: string,
  op: FieldOp,
  plans?: Record<string, TagPlan>,
): StageResult {
  if (op.op === "replace") {
    const error = applyFindReplace("", op.rule).error;
    if (error) return { staged, skipped: [], error };
  }
  const out = copyStaged(staged);
  const skipped: string[] = [];
  for (const f of files) {
    if (f.info === undefined || !planOffers(plans?.[f.path], field)) {
      skipped.push(f.path);
      continue;
    }
    if (field === "gps" && op.op !== "clear") continue; // a location can only be removed
    const onFile = currentValue(f.info, field);
    const already = out[f.path];
    const hasStaged = already !== undefined && field in already;
    // An operation works on what the field will read after the edits already staged
    // (append, then prepend), while "unchanged" is always measured against the file.
    const base = hasStaged ? (already[field] ?? undefined) : onFile;
    if (readsOldValue(op) && !hasStaged && isCut(onFile, f.info)) {
      skipped.push(f.path);
      continue;
    }
    const value = nextValue(op, base);
    if (value === undefined) continue;
    if (value !== null && value.length > MAX_VALUE_CHARS) {
      return {
        staged,
        skipped: [],
        error: `Too long: a tag can hold at most ${MAX_VALUE_CHARS.toLocaleString("en-US")} characters.`,
      };
    }
    const entry = (out[f.path] ??= {});
    if (value === null ? onFile === undefined : same(value, onFile)) delete entry[field];
    else entry[field] = value;
  }
  for (const path of Object.keys(out)) if (Object.keys(out[path]!).length === 0) delete out[path];
  return { staged: out, skipped, error: null };
}

/** Forget the staged value of `field` for the given files. Never mutates `staged`. */
export function unstageField(staged: Staged, paths: string[], field: string): Staged {
  const out = copyStaged(staged);
  for (const path of paths) {
    if (!out[path]) continue;
    delete out[path][field];
    if (Object.keys(out[path]).length === 0) delete out[path];
  }
  return out;
}

/** What a field reads as with this file's staged edit applied (a staged clear reads as empty). */
export function effectiveValue(
  info: OrganizeTagInfo | null | undefined,
  stagedForFile: Record<string, string | null> | undefined,
  field: string,
): string | undefined {
  if (stagedForFile && field in stagedForFile) return stagedForFile[field] ?? undefined;
  return currentValue(info, field);
}

/**
 * The review step's rows: for every staged file, each change as before → after and how it
 * will be written. `snapshots` are the tags each file had when staged (what the user saw).
 * Files whose staged values equal what they have are left out (the caller counts them as
 * skipped).
 */
export function buildReview(
  staged: Staged,
  snapshots: Record<string, OrganizeTagInfo | null>,
  plans: Record<string, TagPlan>,
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const path of Object.keys(staged).sort()) {
    const edits = staged[path]!;
    const snap = snapshots[path];
    const plan = plans[path];
    const changes: ReviewChange[] = [];
    const blocked: string[] = [];
    for (const [field, after] of Object.entries(edits)) {
      const before = currentValue(snap, field);
      if (plan?.writable && !planOffers(plan, field)) {
        blocked.push(field);
        continue;
      }
      if (after === null ? before === undefined : same(after, before)) continue;
      changes.push({ field, before, after });
    }
    if (changes.length === 0 && blocked.length === 0) continue;
    rows.push({
      path,
      changes,
      blocked,
      how: plan?.how ?? null,
      reason: plan && !plan.writable ? plan.reason : null,
      note: plan?.note ?? null,
    });
  }
  return rows;
}

/** What to send: files that can be written, with only their changed, allowed fields. */
export function toApplyItems(rows: ReviewRow[]): TagApplyItem[] {
  return rows
    .filter((r) => r.how !== null && r.reason === null && r.changes.length > 0)
    .map((r) => ({
      path: r.path,
      set: Object.fromEntries(r.changes.map((c) => [c.field, c.after])),
    }));
}
