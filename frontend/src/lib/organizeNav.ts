import { parentPath } from "@/lib/path";

/**
 * Organize keeps the open folder in the URL (`/organize?path=<absolute folder>`, no param
 * = the saved root) so the browser's Back/Forward walk the folders visited.
 * These helpers build and read that param; the backend still sandboxes every path.
 */

/**
 * Canonical form of a folder path from the URL: repeated and trailing slashes
 * dropped. Null for anything that is not a plain absolute POSIX path (empty,
 * relative, a `.`/`..` segment, a NUL).
 */
export function normalizeFolderPath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.includes("\0")) return null;
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) return null;
  return `/${parts.join("/")}`;
}

/** Whether `path` is the root or a folder under it (both already absolute). */
export function isWithinRoot(path: string, root: string): boolean {
  const r = normalizeFolderPath(root) ?? root;
  if (r === "/") return path.startsWith("/");
  return path === r || path.startsWith(`${r}/`);
}

/**
 * The folder to open for a `?path=` value. No param opens the root; a malformed
 * value or one outside the root falls back to the root with `valid: false`, so the
 * page shows its "folder gone" state instead of listing something unexpected.
 */
export function resolveOpenFolder(
  param: string | null,
  root: string,
): { path: string; valid: boolean } {
  const r = normalizeFolderPath(root) ?? root;
  if (param === null) return { path: r, valid: true };
  const path = normalizeFolderPath(param);
  if (path === null || !isWithinRoot(path, r)) return { path: r, valid: false };
  return { path, valid: true };
}

/**
 * The location search that opens `path`: "" for the root, else `?path=…` with every
 * component percent-encoded (`%`, `&`, `#`, `+`, spaces, non-ASCII) but the slashes
 * left readable. `URLSearchParams` decodes it back to `path` exactly.
 */
export function folderSearch(path: string, root: string): string {
  if (path === (normalizeFolderPath(root) ?? root)) return "";
  return `?path=${encodeURIComponent(path).replace(/%2F/g, "/")}`;
}

/**
 * Where to go after the folder `deleted` is removed: its parent when the open folder
 * (`current`) is that folder or inside it, else null (stay put).
 */
export function folderAfterDelete(deleted: string, current: string): string | null {
  return current === deleted || current.startsWith(`${deleted}/`) ? parentPath(deleted) : null;
}
