import { useCallback, useMemo, useState } from "react";

export type Operator =
  "gt" | "lt" | "gte" | "lte" | "eq" | "contains" | "not_contains" | "fuzzy_contains";

type ValueType = "number" | "date_offset" | "text" | "percent" | "select" | "boolean";

type FieldCategory = "numeric" | "label" | "search";

export type Clause = {
  id: string;
  fieldKey: string;
  operator: Operator;
  value: unknown;
  joinToNext: "AND" | "OR";
};

export type FieldDef<T> = {
  key: string;
  label: string;
  category: FieldCategory;
  valueType: ValueType;
  operators: Operator[];
  defaultOperator: Operator;
  defaultValue: unknown;
  test?: (row: T, operator: Operator, value: unknown) => boolean;
  getRowId?: (row: T) => number;
  showThreshold?: boolean; // for "text" valueType — always show a % threshold input, not only for fuzzy_contains
  group?: string; // optional sub-heading within a category in the add-filter menu (e.g. "Exposed" within "label")
  presets?: { label: string; value: unknown }[]; // quick-set chips shown above the value editor (e.g. resolution tiers)
  unitLabel?: string; // short unit hint shown beside a "number" valueType input (e.g. "seconds", "fps", "px")
  options?: { label: string; value: unknown }[]; // fixed choices for a "select" valueType field (e.g. orientation)
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function evaluateOne<T>(
  clause: Clause,
  row: T,
  fields: Record<string, FieldDef<T>>,
  scoreMaps: Record<string, Map<number, number>>,
): boolean {
  const field = fields[clause.fieldKey];
  if (!field || !hasValue(clause.value)) return true;

  if (field.test) {
    return field.test(row, clause.operator, clause.value);
  }

  if (field.getRowId) {
    const map = scoreMaps[clause.id];
    const score = map?.get(field.getRowId(row));
    if (score === undefined) return true; // fail open — not yet resolved / fetch failed
    // Score-map-backed fields normally carry a plain numeric threshold, but a
    // "text" valueType field (e.g. semantic search) carries { text, threshold }
    // with threshold expressed as a 0-100 percent — normalise to the score's scale.
    const raw = clause.value;
    const threshold =
      typeof raw === "object" && raw !== null && "threshold" in raw
        ? ((raw as { threshold?: number }).threshold ?? 0) / 100
        : (raw as number);
    return clause.operator === "gte" ? score >= threshold : score < threshold;
  }

  return true;
}

export function evaluateClauses<T>(
  clauses: Clause[],
  row: T,
  fields: Record<string, FieldDef<T>>,
  scoreMaps: Record<string, Map<number, number>>,
): boolean {
  if (clauses.length === 0) return true;
  let result = evaluateOne(clauses[0], row, fields, scoreMaps);
  for (let i = 1; i < clauses.length; i++) {
    const joiner = clauses[i - 1].joinToNext;
    const next = evaluateOne(clauses[i], row, fields, scoreMaps);
    result = joiner === "AND" ? result && next : result || next;
  }
  return result;
}

export function useQueryBuilder<T>(registry: FieldDef<T>[]) {
  const [clauses, setClauses] = useState<Clause[]>([]);

  const fieldsByKey = useMemo(
    () => Object.fromEntries(registry.map((f) => [f.key, f])) as Record<string, FieldDef<T>>,
    [registry],
  );

  const addClause = useCallback(
    (fieldKey: string): string | null => {
      const field = fieldsByKey[fieldKey];
      if (!field) return null;
      const id = `${fieldKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setClauses((prev) => [
        ...prev,
        {
          id,
          fieldKey,
          operator: field.defaultOperator,
          value: field.defaultValue,
          joinToNext: "AND",
        },
      ]);
      return id;
    },
    [fieldsByKey],
  );

  const removeClause = useCallback((id: string) => {
    setClauses((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateClause = useCallback((id: string, patch: Partial<Clause>) => {
    setClauses((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const evaluate = useCallback(
    (row: T, scoreMaps: Record<string, Map<number, number>> = {}) =>
      evaluateClauses(clauses, row, fieldsByKey, scoreMaps),
    [clauses, fieldsByKey],
  );

  return { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate };
}
