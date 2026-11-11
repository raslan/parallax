/**
 * Rename planning for Organize: turns a rule ("find X, replace with Y", or a typed name)
 * into old → new rows the dialog previews. Pure; the server stays the authority and
 * refuses anything this lets through (it never overwrites).
 */

import { compileFindReplace, type FindRule } from "@/lib/findReplace";

export interface RenameItem {
  path: string;
  name: string;
}

type RenameStatus = "ok" | "unchanged" | "invalid" | "taken";

export interface RenameRow {
  path: string;
  oldName: string;
  newName: string;
  status: RenameStatus;
}

export interface RenamePlan {
  rows: RenameRow[];
  /** The regex failed to compile (a message for the dialog), else null. */
  regexError: string | null;
}

const MAX_NAME_BYTES = 255;

/** Same rules as the backend's `_validate_name`: one visible path component. */
function isValidName(name: string): boolean {
  if (
    !name.trim() ||
    /[/\\\0]/.test(name) ||
    name === "." ||
    name === ".." ||
    name.startsWith(".")
  ) {
    return false;
  }
  return new TextEncoder().encode(name).length <= MAX_NAME_BYTES;
}

/** `[stem, extension-with-dot]`; a leading dot is not an extension. */
export function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Classifies each candidate name. `taken` is every name already in the folder; a name
 * produced twice in one batch counts as taken for the second item. Conservative on
 * chains (a → b while b is renamed away): the server handles items in order.
 */
function classify(
  items: readonly RenameItem[],
  newNames: readonly string[],
  taken: ReadonlySet<string>,
): RenameRow[] {
  const seen = new Set<string>();
  return items.map((it, i) => {
    const newName = (newNames[i] ?? it.name).trim();
    let status: RenameStatus = "ok";
    if (newName === it.name) status = "unchanged";
    else if (!isValidName(newName)) status = "invalid";
    else if (taken.has(newName) || seen.has(newName)) status = "taken";
    if (status === "ok") seen.add(newName);
    return { path: it.path, oldName: it.name, newName, status };
  });
}

/** One item renamed to a typed name (the whole name, extension included). */
export function planSingleRename(
  item: RenameItem,
  typed: string,
  taken: ReadonlySet<string>,
): RenameRow {
  return classify([item], [typed], taken)[0]!;
}

/**
 * Find/replace over each name's stem; the extension is left alone. An empty `find`
 * changes nothing. Literal mode never interprets `$` in `replace`.
 */
export function planBulkRename(
  items: readonly RenameItem[],
  rule: FindRule,
  taken: ReadonlySet<string>,
): RenamePlan {
  const compiled = compileFindReplace(rule);
  if (compiled.error) return { rows: classify(items, [], taken), regexError: compiled.error };
  const newNames = items.map((it) => {
    const [stem, ext] = splitExtension(it.name);
    return compiled.apply(stem) + ext;
  });
  return { rows: classify(items, newNames, taken), regexError: null };
}
