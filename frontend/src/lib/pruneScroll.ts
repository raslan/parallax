import type { Clause } from "@/hooks/useQueryBuilder";

/**
 * Identity of the active filter, ignoring clause ids. The page scrolls back to the top
 * when this changes (the result set was swapped for an unrelated one) but not when the
 * file list merely refetches or details stream in.
 */
export function clauseSignature(clauses: readonly Clause[]): string {
  return JSON.stringify(clauses.map((c) => [c.fieldKey, c.operator, c.value, c.joinToNext]));
}
