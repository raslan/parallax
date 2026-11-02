import type { Clause } from "@/hooks/useQueryBuilder";

/**
 * Identity of the active filter, ignoring clause ids. The page scrolls back to the top
 * when this changes (the result set was swapped for an unrelated one) but not when the
 * file list merely refetches or details stream in.
 */
export function clauseSignature(clauses: readonly Clause[]): string {
  return JSON.stringify(clauses.map((c) => [c.fieldKey, c.operator, c.value, c.joinToNext]));
}

/**
 * The filter signature plus every sort's key and direction: a re-sort reorders the
 * whole list, so the page scrolls to the top for it just like for a filter change.
 */
export function viewSignature(
  clauses: readonly Clause[],
  sorts: readonly { key: string; dir: string }[],
): string {
  return `${clauseSignature(clauses)}|${sorts.map((s) => `${s.key}:${s.dir}`).join(",")}`;
}
