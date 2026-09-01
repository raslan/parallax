export type Operator =
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "eq"
  | "contains"
  | "not_contains"
  | "fuzzy_contains";

export type ValueType = "number" | "date_offset" | "text" | "percent";

export type FieldCategory = "numeric" | "label" | "search";

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
    return clause.operator === "gte" ? score >= (clause.value as number) : score < (clause.value as number);
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
